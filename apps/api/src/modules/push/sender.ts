// ADR-309 — the task pop-up sender. Reads pending task_notices and sends each
// to the recipient's switched-on browsers via Web Push (VAPID).
//
// - Woken by kickPushSender() (after the task write commits, debounced 150 ms)
//   and by a retry tick every PUSH_RETRY_INTERVAL_MS — the tick also picks up
//   a notice whose kick fired before its task transaction committed. Started
//   from server.ts only (never under test).
// - NO network call inside a database transaction. A flush is three steps,
//   each its own short autocommitted statement(s):
//     1. claim (claim.ts): bump push_attempts on up to 50 pending rows; the
//        updated_at the trigger sets is the lease, so neither another API
//        instance nor the next tick / kick re-claims a row within
//        PUSH_RETRY_BACKOFF_MS;
//     2. read the task details + subscriptions, then send (a few at once);
//     3. settle each outcome with its own UPDATE (… AND push_status =
//        'pending'). A delivered pop-up can never be rolled back into a resend.
// - No / invalid VAPID keys → every pending notice becomes 'off'; nothing is
//   sent (invalid keys log one error, see vapid()).
// - A push failure NEVER reaches a task action: the sender runs on its own
//   connection, after the task transaction, and swallows + logs every error.

import { randomUUID } from 'node:crypto';
import {
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_BACKOFF_MS,
  PUSH_RETRY_INTERVAL_MS,
  type TaskNoticeKind,
  type TaskPriority,
  type TaskPushPayload,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../../db/client';
import { env } from '../../lib/env';
import { type Logger, logger as rootLogger } from '../../lib/logger';
import { claimPendingSql } from './claim';
import { setPushKicker } from './kick';
import { type VapidConfig, buildTaskPushPayload, pushDecision, vapidFrom } from './payload';
import { vapidProblem } from './vapid';

const CLAIM_BATCH = 50;
/** Kicks now arrive after commit; this only batches a burst of them. */
const KICK_DEBOUNCE_MS = 150;
const SEND_TIMEOUT_MS = 10_000;
const PUSH_TTL_SECONDS = 24 * 3600;
/** Notices sent at the same time within one flush. */
const SEND_CONCURRENCY = 5;

let vapidMemo: { value: VapidConfig | null } | null = null;

/** The server's VAPID keys, or null (pop-ups off). Built and validated once:
 *  any key missing → off; present but invalid (bad subject / key) → off, with
 *  ONE error logged saying why. */
export function vapid(): VapidConfig | null {
  if (vapidMemo) return vapidMemo.value;
  const cfg = vapidFrom(env);
  const problem = cfg ? vapidProblem(cfg) : null;
  if (cfg && problem) {
    rootLogger.error({ reason: problem }, 'task pop-ups off: VAPID settings are invalid');
  }
  vapidMemo = { value: cfg && !problem ? cfg : null };
  return vapidMemo.value;
}

export interface PushSub {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = 'ok' | 'gone' | 'error';

/** Send one payload to each subscription. Never throws. */
export async function sendToSubscriptions(
  subs: readonly PushSub[],
  payload: TaskPushPayload,
  keys: VapidConfig,
  log: Logger,
): Promise<Map<string, SendResult>> {
  const body = JSON.stringify(payload);
  const out = new Map<string, SendResult>();
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          {
            TTL: PUSH_TTL_SECONDS,
            timeout: SEND_TIMEOUT_MS,
            vapidDetails: {
              subject: keys.subject,
              publicKey: keys.publicKey,
              privateKey: keys.privateKey,
            },
          },
        );
        out.set(sub.id, res.statusCode >= 200 && res.statusCode < 300 ? 'ok' : 'error');
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          out.set(sub.id, 'gone');
        } else {
          out.set(sub.id, 'error');
          log.warn({ err, subscriptionId: sub.id, status }, 'push send failed');
        }
      }
    }),
  );
  return out;
}

/** Soft-delete subscriptions the push service says are gone (404/410) and
 *  stamp gone_at (a re-save of that endpoint is then refused, 0258); stamp
 *  last_success_at on the ones that worked. Own short statements — never
 *  inside a transaction that also sent. */
export async function applySendResults(
  subs: readonly PushSub[],
  results: ReadonlyMap<string, SendResult>,
): Promise<void> {
  const gone = subs.filter((x) => results.get(x.id) === 'gone').map((x) => x.id);
  const ok = subs.filter((x) => results.get(x.id) === 'ok').map((x) => x.id);
  if (gone.length) {
    await db.execute(sql`UPDATE public.push_subscriptions
      SET deleted_at = COALESCE(deleted_at, now()), deleted_by = COALESCE(deleted_by, user_id),
        gone_at = now()
      WHERE id = ANY(${sql.param(gone)}::uuid[]) AND gone_at IS NULL`);
  }
  if (ok.length) {
    await db.execute(sql`UPDATE public.push_subscriptions SET last_success_at = now()
      WHERE id = ANY(${sql.param(ok)}::uuid[])`);
  }
}

type Row = Record<string, unknown>;
const rowsOf = (v: unknown): Row[] => v as Row[];
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dayOf = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : s(v);

/** Run `fn` over `items`, at most `limit` at a time. */
async function inPool<T>(
  items: readonly T[],
  limit: number,
  fn: (x: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

type Settled = 'sent' | 'failed' | 'off';

/** Write one outcome for some claimed notices (own statement). */
async function settle(status: Settled, which: readonly string[]): Promise<void> {
  if (which.length === 0) return;
  await db.execute(sql`UPDATE public.task_notices
    SET push_status = ${status}, sent_at = ${status === 'sent' ? sql`now()` : sql`sent_at`}
    WHERE id = ANY(${sql.param([...which])}::uuid[]) AND push_status = 'pending'`);
}

/** One flush: claim, send outside any transaction, settle. Returns how many
 *  rows it claimed (a row left pending is leased, so the loop calling this
 *  does not re-claim it). */
async function flushBatch(log: Logger): Promise<number> {
  const all = rowsOf(await db.execute(claimPendingSql(CLAIM_BATCH, PUSH_RETRY_BACKOFF_MS)));
  if (all.length === 0) return 0;
  // ADR-314 — recipient's Desktop Pop-ups disabled: settle 'off', never send.
  await settle(
    'off',
    all.filter((r) => r['popups_off'] === true).map((r) => String(r['id'])),
  );
  const claimed = all.filter((r) => r['popups_off'] !== true);
  if (claimed.length === 0) return all.length;
  const ids = claimed.map((r) => String(r['id']));
  const keys = vapid();
  if (!keys) {
    await settle('off', ids);
    return all.length;
  }

  const recipients = [...new Set(claimed.map((r) => String(r['recipient_id'])))];
  const [details, subRows] = await Promise.all([
    db.execute(sql`
      SELECT n.id::text AS id, n.kind, t.id::text AS task_id, t.code, t.title, t.due_date,
        t.priority, t.completion_remark, (t.created_by = n.recipient_id) AS recipient_is_creator,
        COALESCE(NULLIF(btrim(u.full_name), ''), u.email) AS actor
      FROM public.task_notices n
      JOIN public.tasks t ON t.id = n.task_id AND t.company_id = n.company_id
        AND t.deleted_at IS NULL
      LEFT JOIN public.users u ON u.id = n.actor_id
      WHERE n.id = ANY(${sql.param(ids)}::uuid[])`),
    db.execute(sql`
      SELECT ps.id::text AS id, ps.company_id::text AS company_id, ps.user_id::text AS user_id,
        ps.endpoint, ps.p256dh, ps.auth
      FROM public.push_subscriptions ps
      WHERE ps.deleted_at IS NULL AND ps.user_id = ANY(${sql.param(recipients)}::uuid[])`),
  ]);
  const detailById = new Map(rowsOf(details).map((d) => [String(d['id']), d]));
  const subsByUser = new Map<string, Array<PushSub & { companyId: string }>>();
  for (const r of rowsOf(subRows)) {
    const k = String(r['user_id']);
    const list = subsByUser.get(k) ?? [];
    list.push({
      id: String(r['id']),
      companyId: String(r['company_id']),
      userId: k,
      endpoint: String(r['endpoint']),
      p256dh: String(r['p256dh']),
      auth: String(r['auth']),
    });
    subsByUser.set(k, list);
  }

  const out: Record<Settled, string[]> = { sent: [], failed: [], off: [] };
  const now = new Date();
  await inPool(claimed, SEND_CONCURRENCY, async (c) => {
    const id = String(c['id']);
    const d = detailById.get(id);
    // The task is gone (soft-deleted) → nothing to tell.
    if (!d) {
      out.off.push(id);
      return;
    }
    const subs = (subsByUser.get(String(c['recipient_id'])) ?? []).filter(
      (x) => x.companyId === String(c['company_id']),
    );
    const eventAt = c['event_at'] instanceof Date ? c['event_at'] : new Date(String(c['event_at']));
    const decision = pushDecision(eventAt, {
      vapidOn: true,
      hasSubscription: subs.length > 0,
      now,
    });
    if (decision !== 'send') {
      out[decision].push(id);
      return;
    }
    const payload = buildTaskPushPayload({
      noticeId: id,
      kind: String(d['kind']) as TaskNoticeKind,
      taskId: String(d['task_id']),
      recipientIsCreator: d['recipient_is_creator'] === true,
      code: String(d['code'] ?? ''),
      title: String(d['title'] ?? ''),
      dueDate: dayOf(d['due_date']),
      priority: s(d['priority']) as TaskPriority | null,
      actorName: s(d['actor']),
      completionRemark: s(d['completion_remark']),
    });
    const results = await sendToSubscriptions(subs, payload, keys, log);
    await applySendResults(subs, results);
    const vals = [...results.values()];
    if (vals.includes('ok')) out.sent.push(id);
    else if (vals.every((v) => v === 'gone')) out.off.push(id);
    else if (Number(c['push_attempts']) >= PUSH_MAX_ATTEMPTS) out.failed.push(id);
    // else: stays pending (leased); tried again after PUSH_RETRY_BACKOFF_MS.
  });
  await settle('sent', out.sent);
  await settle('failed', out.failed);
  await settle('off', out.off);
  return all.length;
}

let running = false;
let again = false;

/** Flush until a batch comes back short. Never throws. */
export async function flushPendingPushes(log: Logger = rootLogger): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      let claimedCount: number;
      let rounds = 0;
      do {
        claimedCount = await flushBatch(log);
        rounds += 1;
      } while (claimedCount >= CLAIM_BATCH && rounds < 20);
    } while (again);
  } catch (err) {
    log.error({ err }, 'push sender flush failed');
  } finally {
    running = false;
  }
}

let tick: NodeJS.Timeout | null = null;
let debounce: NodeJS.Timeout | null = null;

/** Start the retry tick and accept kicks. server.ts only. */
export function startPushSender(log: Logger = rootLogger): void {
  if (tick) return;
  setPushKicker(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void flushPendingPushes(log);
    }, KICK_DEBOUNCE_MS);
    debounce.unref();
  });
  tick = setInterval(() => void flushPendingPushes(log), PUSH_RETRY_INTERVAL_MS);
  tick.unref();
  log.info({ enabled: vapid() !== null }, 'task pop-up sender started');
  void flushPendingPushes(log);
}

export function stopPushSender(): void {
  setPushKicker(null);
  if (tick) clearInterval(tick);
  if (debounce) clearTimeout(debounce);
  tick = null;
  debounce = null;
}

/** A test pop-up for one person's browsers (POST /me/push/test). */
export function testPayload(): TaskPushPayload {
  return {
    noticeId: randomUUID(),
    kind: 'task_assigned',
    title: 'Test pop-up · Innovic ERP',
    body: 'Task pop-ups are working on this computer.',
    href: '/task-board',
    actorInitials: null,
  };
}
