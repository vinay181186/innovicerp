// ADR-309 — the task pop-up sender. Reads pending task_notices and sends each
// to the recipient's switched-on browsers via Web Push (VAPID).
//
// - Woken by kickPushSender() (debounced ~1 s, after the task write commits)
//   and by a retry tick every PUSH_RETRY_INTERVAL_MS. Started from server.ts
//   only (never under test).
// - Two API instances never double-send: a flush claims up to 50 pending rows
//   with UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) and keeps that
//   transaction open until the rows' outcome is written, so the other
//   instance skips them.
// - No VAPID keys → every pending notice becomes 'off'; nothing is sent.
// - A push failure NEVER reaches a task action: the sender runs on its own
//   connection, after the task transaction, and swallows + logs every error.

import { randomUUID } from 'node:crypto';
import {
  PUSH_MAX_ATTEMPTS,
  PUSH_RETRY_INTERVAL_MS,
  type TaskNoticeKind,
  type TaskPriority,
  type TaskPushPayload,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import webpush from 'web-push';
import { db } from '../../db/client';
import type { DbTransaction } from '../../db/with-user-context';
import { env } from '../../lib/env';
import { type Logger, logger as rootLogger } from '../../lib/logger';
import { setPushKicker } from './kick';
import { type VapidConfig, buildTaskPushPayload, pushDecision, vapidFrom } from './payload';

const CLAIM_BATCH = 50;
const KICK_DEBOUNCE_MS = 1_000;
const SEND_TIMEOUT_MS = 10_000;
const PUSH_TTL_SECONDS = 24 * 3600;

/** The server's VAPID keys, or null (pop-ups off). */
export const vapid = (): VapidConfig | null => vapidFrom(env);

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
    subs.map(async (s) => {
      try {
        const res = await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
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
        out.set(s.id, res.statusCode >= 200 && res.statusCode < 300 ? 'ok' : 'error');
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          out.set(s.id, 'gone');
        } else {
          out.set(s.id, 'error');
          log.warn({ err, subscriptionId: s.id, status }, 'push send failed');
        }
      }
    }),
  );
  return out;
}

/** Soft-delete subscriptions the push service says are gone (404/410), and
 *  stamp last_success_at on the ones that worked. */
export async function applySendResults(
  tx: DbTransaction,
  subs: readonly PushSub[],
  results: ReadonlyMap<string, SendResult>,
): Promise<void> {
  const gone = subs.filter((s) => results.get(s.id) === 'gone').map((s) => s.id);
  const ok = subs.filter((s) => results.get(s.id) === 'ok').map((s) => s.id);
  if (gone.length) {
    await tx.execute(sql`UPDATE public.push_subscriptions
      SET deleted_at = now(), deleted_by = user_id
      WHERE id = ANY(${sql.param(gone)}::uuid[]) AND deleted_at IS NULL`);
  }
  if (ok.length) {
    await tx.execute(sql`UPDATE public.push_subscriptions SET last_success_at = now()
      WHERE id = ANY(${sql.param(ok)}::uuid[])`);
  }
}

type Row = Record<string, unknown>;
const rowsOf = (v: unknown): Row[] => v as Row[];
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const dayOf = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : s(v);

/** One flush inside one transaction. Returns how many notices it settled. */
async function flushBatch(log: Logger): Promise<number> {
  return db.transaction(async (tx) => {
    const claimed = rowsOf(
      await tx.execute(sql`
        UPDATE public.task_notices n SET push_attempts = n.push_attempts + 1
        WHERE n.id IN (
          SELECT p.id FROM public.task_notices p
          WHERE p.push_status = 'pending' AND p.deleted_at IS NULL
          ORDER BY p.event_at
          LIMIT ${CLAIM_BATCH}
          FOR UPDATE SKIP LOCKED)
        RETURNING n.id::text AS id, n.company_id::text AS company_id,
          n.recipient_id::text AS recipient_id, n.event_at, n.push_attempts`),
    );
    if (claimed.length === 0) return 0;
    const ids = claimed.map((r) => String(r['id']));
    const keys = vapid();
    const settle = async (status: 'sent' | 'failed' | 'off', which: string[]): Promise<void> => {
      if (which.length === 0) return;
      await tx.execute(sql`UPDATE public.task_notices
        SET push_status = ${status}, sent_at = ${status === 'sent' ? sql`now()` : sql`sent_at`}
        WHERE id = ANY(${sql.param(which)}::uuid[])`);
    };
    if (!keys) {
      await settle('off', ids);
      return ids.length;
    }

    const [details, subRows] = await Promise.all([
      tx.execute(sql`
        SELECT n.id::text AS id, n.kind, t.id::text AS task_id, t.code, t.title, t.due_date,
          t.priority, t.completion_remark,
          COALESCE(NULLIF(btrim(u.full_name), ''), u.email) AS actor
        FROM public.task_notices n
        JOIN public.tasks t ON t.id = n.task_id AND t.company_id = n.company_id
        LEFT JOIN public.users u ON u.id = n.actor_id
        WHERE n.id = ANY(${sql.param(ids)}::uuid[])`),
      tx.execute(sql`
        SELECT ps.id::text AS id, ps.company_id::text AS company_id, ps.user_id::text AS user_id,
          ps.endpoint, ps.p256dh, ps.auth
        FROM public.push_subscriptions ps
        WHERE ps.deleted_at IS NULL
          AND ps.user_id = ANY(${sql.param([...new Set(claimed.map((r) => String(r['recipient_id'])))])}::uuid[])`),
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

    const sent: string[] = [];
    const failed: string[] = [];
    const off: string[] = [];
    const now = new Date();
    for (const c of claimed) {
      const id = String(c['id']);
      const d = detailById.get(id);
      const subs = (subsByUser.get(String(c['recipient_id'])) ?? []).filter(
        (x) => x.companyId === String(c['company_id']),
      );
      const eventAt =
        c['event_at'] instanceof Date ? c['event_at'] : new Date(String(c['event_at']));
      const decision = d
        ? pushDecision(eventAt, { vapidOn: true, hasSubscription: subs.length > 0, now })
        : 'failed';
      if (decision !== 'send') {
        (decision === 'off' ? off : failed).push(id);
        continue;
      }
      const payload = buildTaskPushPayload({
        noticeId: id,
        kind: String(d!['kind']) as TaskNoticeKind,
        taskId: String(d!['task_id']),
        code: String(d!['code'] ?? ''),
        title: String(d!['title'] ?? ''),
        dueDate: dayOf(d!['due_date']),
        priority: s(d!['priority']) as TaskPriority | null,
        actorName: s(d!['actor']),
        completionRemark: s(d!['completion_remark']),
      });
      const results = await sendToSubscriptions(subs, payload, keys, log);
      await applySendResults(tx, subs, results);
      const vals = [...results.values()];
      if (vals.includes('ok')) sent.push(id);
      else if (vals.every((v) => v === 'gone')) off.push(id);
      else if (Number(c['push_attempts']) >= PUSH_MAX_ATTEMPTS) failed.push(id);
      // else: stays pending, the retry tick tries again.
    }
    await settle('sent', sent);
    await settle('failed', failed);
    await settle('off', off);
    return sent.length + failed.length + off.length;
  });
}

let running = false;
let again = false;

/** Flush until nothing pending is left in a full batch. Never throws. */
export async function flushPendingPushes(log: Logger = rootLogger): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      let settled: number;
      let rounds = 0;
      do {
        settled = await flushBatch(log);
        rounds += 1;
      } while (settled >= CLAIM_BATCH && rounds < 20);
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
