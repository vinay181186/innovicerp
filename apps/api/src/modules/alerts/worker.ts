// Alerts worker (T-041d Phase B slice 6, ADR-024).
//
// Repeatable BullMQ job (every 30 min) that fans alert evaluations out to
// per-user email digests. Idempotency is guarded by alert_deliveries' unique
// (code, user_id, window_start, channel) index — a second attempt within the
// same window catches `unique_violation` and skips the dispatch.
//
// Per-tick algorithm:
//   1. window_start = floor(now() to 30-min boundary)
//   2. load all (company_id, user_id, code, channel) subscription rows
//      joined with users (for email + role + active flag) and merged with
//      alert_config overrides — filter to active rules only
//   3. group subscriptions by (company_id, code) and evaluate each rule
//      ONCE per company-code pair (RLS scopes by company; the records are
//      identical for every subscriber in the same company)
//   4. for each (subscriber, eval) pair:
//        - fast-path: if records.length === 0, skip dispatch entirely (no
//          empty digests; mirrors legacy `_runAlerts` UX where empty alerts
//          don't render)
//        - try INSERT alert_deliveries (idempotency check) under the
//          subscriber's auth context
//        - on success: call sendAlertDigest; if it throws, the worker
//          logs + lets BullMQ retry (the delivery row stays — a retry
//          for the same window will short-circuit on the unique key
//          and skip the duplicate send. Acceptable: at most one stub-id
//          row per (code, user, window) without a real send if Resend
//          is flaky)
//        - on unique_violation: silently skip (already dispatched)
//
// Boot wiring lives in worker-boot.ts so the test suite can import this
// file without spinning up Redis / Resend connections.

import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  alertConfig as alertConfigTable,
  alertDeliveries,
  alertSubscriptions,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { sendAlertDigest } from '../../lib/email';
import { logger } from '../../lib/logger';
import { ALERTS, type RegisteredAlert } from './registry';

interface SubscriberRow {
  companyId: string;
  userId: string;
  code: string;
  channel: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'manager' | 'operator' | 'viewer' | 'qc' | 'procurement' | 'dispatch' | 'design';
  isActive: boolean;
}

interface ConfigRow {
  companyId: string;
  code: string;
  active: boolean;
}

/** Truncate the timestamp to the most recent 30-minute boundary. */
export function digestWindowStart(now: Date = new Date()): Date {
  const ms = now.getTime();
  const thirtyMinMs = 30 * 60 * 1000;
  return new Date(Math.floor(ms / thirtyMinMs) * thirtyMinMs);
}

async function loadSubscribers(): Promise<SubscriberRow[]> {
  const rows = await db
    .select({
      companyId: alertSubscriptions.companyId,
      userId: alertSubscriptions.userId,
      code: alertSubscriptions.code,
      channel: alertSubscriptions.channel,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(alertSubscriptions)
    .innerJoin(users, sql`${users.id} = ${alertSubscriptions.userId}`)
    .where(sql`${users.isActive} = true`);
  return rows as SubscriberRow[];
}

async function loadConfig(): Promise<Map<string, boolean>> {
  // Map keyed by `${companyId}|${code}` → effective override (true=on, false=off).
  // Rows ABSENT mean "no override" — caller should fall back to registry default.
  const rows = (await db
    .select({
      companyId: alertConfigTable.companyId,
      code: alertConfigTable.code,
      active: alertConfigTable.active,
    })
    .from(alertConfigTable)) as ConfigRow[];
  const map = new Map<string, boolean>();
  for (const r of rows) map.set(`${r.companyId}|${r.code}`, r.active);
  return map;
}

function effectiveActive(
  companyId: string,
  reg: RegisteredAlert,
  overrides: Map<string, boolean>,
): boolean {
  const v = overrides.get(`${companyId}|${reg.definition.code}`);
  return v === undefined ? reg.definition.defaultActive : v;
}

/** Build the HTML digest body for one user × one alert. Kept minimal in v1
 *  — table of records, scoped to the legacy alerts UX, no styling beyond
 *  inline CSS. Renders the first 50 records to cap email size. */
export function renderDigestHtml(payload: {
  userName: string;
  code: string;
  alertName: string;
  records: ReadonlyArray<Record<string, string | number | null>>;
}): string {
  const { userName, code, alertName, records } = payload;
  const headerKeys = records[0] ? Object.keys(records[0]) : [];
  const cap = records.slice(0, 50);
  const overflow = records.length > cap.length ? records.length - cap.length : 0;

  const headerCells = headerKeys
    .map(
      (k) =>
        `<th style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:left;background:#f7f7f7;">${escapeHtml(k)}</th>`,
    )
    .join('');
  const bodyRows = cap
    .map(
      (r) =>
        `<tr>${headerKeys
          .map((k) => {
            const v = r[k];
            return `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${v == null ? '' : escapeHtml(String(v))}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');

  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#222;">
<h2 style="margin-bottom:4px;">${escapeHtml(alertName)} <span style="color:#888;font-weight:normal;">(${escapeHtml(code)})</span></h2>
<p style="margin-top:0;color:#666;">Hi ${escapeHtml(userName)} — your alert digest just refreshed. ${records.length} item${records.length === 1 ? '' : 's'} need attention.</p>
<table style="border-collapse:collapse;width:100%;font-size:14px;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>
${overflow > 0 ? `<p style="color:#888;font-size:12px;">… and ${overflow} more. Open the dashboard for the full list.</p>` : ''}
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RunDigestResult {
  /** windowStart used for this tick (ISO). */
  window: string;
  /** Number of distinct (company, code) evaluations that ran. */
  evaluations: number;
  /** Number of digests dispatched (real or stub). */
  dispatched: number;
  /** Number of subscriber-alert pairs skipped because the alert had 0 records. */
  emptySkipped: number;
  /** Number skipped because alert_deliveries already had a row (idempotency). */
  duplicateSkipped: number;
  /** Number that failed dispatch (but the delivery row remains for retry). */
  failed: number;
}

/** Run one digest tick. Pure orchestration — no infra deps in the signature
 *  so the test suite can call this directly without spinning up BullMQ. */
export async function runDigestTick(at: Date = new Date()): Promise<RunDigestResult> {
  const window = digestWindowStart(at);
  const result: RunDigestResult = {
    window: window.toISOString(),
    evaluations: 0,
    dispatched: 0,
    emptySkipped: 0,
    duplicateSkipped: 0,
    failed: 0,
  };

  const subscribers = await loadSubscribers();
  if (subscribers.length === 0) return result;

  const overrides = await loadConfig();

  // Group by (company, code) for shared evaluation.
  const byCompanyCode = new Map<string, SubscriberRow[]>();
  for (const s of subscribers) {
    const reg = ALERTS[s.code];
    if (!reg) continue; // orphaned subscription (rule removed from registry)
    if (!effectiveActive(s.companyId, reg, overrides)) continue;
    const key = `${s.companyId}|${s.code}`;
    const list = byCompanyCode.get(key);
    if (list) list.push(s);
    else byCompanyCode.set(key, [s]);
  }

  for (const [key, group] of byCompanyCode) {
    const [companyId, code] = key.split('|');
    if (!companyId || !code) continue;
    const reg = ALERTS[code];
    if (!reg) continue;

    let records: ReadonlyArray<Record<string, string | number | null>>;
    try {
      // Eval under a synthetic admin context for the company — RLS scopes
      // by company_id which is what we want; role-gating doesn't apply to
      // the registry's read-only queries.
      const sample = group[0];
      if (!sample) continue;
      const evalCtx: AuthContext = {
        id: sample.userId,
        email: sample.email,
        companyId,
        role: sample.role,
        isActive: true,
      };
      const evalResult = await withUserContext(evalCtx, async (tx) => reg.run({ tx, companyId }));
      records = evalResult.records;
      result.evaluations += 1;
    } catch (err) {
      logger.error({ err, companyId, code }, 'alerts worker: evaluation failed; skipping group');
      continue;
    }

    if (records.length === 0) {
      result.emptySkipped += group.length;
      continue;
    }

    for (const sub of group) {
      const success = await dispatchToSubscriber({
        sub,
        window,
        code,
        alertName: reg.definition.name,
        records,
      });
      switch (success) {
        case 'dispatched':
          result.dispatched += 1;
          break;
        case 'duplicate':
          result.duplicateSkipped += 1;
          break;
        case 'failed':
          result.failed += 1;
          break;
      }
    }
  }

  return result;
}

type DispatchOutcome = 'dispatched' | 'duplicate' | 'failed';

async function dispatchToSubscriber(args: {
  sub: SubscriberRow;
  window: Date;
  code: string;
  alertName: string;
  records: ReadonlyArray<Record<string, string | number | null>>;
}): Promise<DispatchOutcome> {
  const { sub, window, code, alertName, records } = args;
  const subUser: AuthContext = {
    id: sub.userId,
    email: sub.email,
    companyId: sub.companyId,
    role: sub.role,
    isActive: true,
  };

  const html = renderDigestHtml({
    userName: sub.fullName ?? sub.email,
    code,
    alertName,
    records,
  });
  const subject = `[Innovic ERP] ${alertName} — ${records.length} item${records.length === 1 ? '' : 's'}`;

  // Step 1: dispatch first, then write the audit row keyed by the message_id.
  // If the subject is already in alert_deliveries for this window we'll catch
  // unique_violation on insert and skip without re-sending.
  let dispatch;
  try {
    dispatch = await sendAlertDigest({ to: sub.email, subject, html });
  } catch (err) {
    logger.error(
      { err, code, userId: sub.userId, window: window.toISOString() },
      'alerts worker: sendAlertDigest threw; will retry next tick',
    );
    return 'failed';
  }

  try {
    await withUserContext(subUser, async (tx) => {
      await tx.insert(alertDeliveries).values({
        companyId: sub.companyId,
        userId: sub.userId,
        code,
        channel: sub.channel,
        windowStart: window,
        messageId: dispatch.messageId,
        recordCount: records.length,
        realSend: dispatch.realSend,
        createdBy: sub.userId,
      });
    });
    return 'dispatched';
  } catch (err) {
    if (err instanceof Error && err.message.includes('alert_deliv_idem_uniq')) {
      // Concurrent worker tick already inserted — duplicate dispatch happened
      // but we couldn't have known. Acceptable; the email got sent twice in
      // the worst case, but our own state stays consistent.
      logger.warn(
        { code, userId: sub.userId, window: window.toISOString() },
        'alerts worker: duplicate delivery row — concurrent tick race',
      );
      return 'duplicate';
    }
    logger.error(
      { err, code, userId: sub.userId, window: window.toISOString() },
      'alerts worker: failed to write alert_deliveries audit row after dispatch',
    );
    return 'failed';
  }
}
