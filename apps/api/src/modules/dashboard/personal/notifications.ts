// ADR-250 — dashboard-only notifications (no email). A note is someone ELSE's
// activity (last 3 India-time days) whose next step is a right the caller
// holds, kept only while that step is still open — asked of the same query
// the matching home list uses (or the approvals inbox for approvals). Full
// Access / role admin callers get none (owner decision).
//
// The "seen" time is the caller's own user_ui_settings row; it only ever
// moves forward (GREATEST in one statement) and never past the server's now.

import type {
  AccessAction,
  AccessFormKey,
  ApprovalInboxResponse,
  DashNote,
  DashTone,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { type DashAccess, hasTick } from '../access';
import { type ListCtx, listDef } from './lists';
import { runList } from './list-query';
import { addDays, codePart, entityHref, str } from './util';

export const NOTIFICATIONS_SEEN_KEY = 'notifications_seen_at';
const NOTE_DAYS = 3;
const NOTE_MAX = 50;

type Open =
  | 'approval_pr'
  | 'approval_po'
  | 'raiser_pr'
  | 'raiser_po'
  | 'pr_to_po'
  | 'po_to_dc'
  | 'grn_qc'
  | 'so_to_plan'
  | 'plan_to_pro'
  | 'ops_ready';

export interface NoteRule {
  entity: string;
  action: string;
  right: readonly [AccessFormKey, AccessAction];
  open: Open;
  verb: string;
  tail: string;
  tone: DashTone;
  /** In-process QC on a job-card op: only when pieces were accepted, and only
   *  the op-entry writer (it sets op_ref). NC-recovery Final Inspection logs
   *  JobCard QC with no op_ref — its pieces go back to ANOTHER card — so it is
   *  not a "next op can start" event and is left out. */
  opQc?: true;
}

// Entity / action strings as each writer emits them (activity_log).
export const NOTE_RULES: readonly NoteRule[] = [
  {
    entity: 'PurchaseRequest',
    action: 'CREATE',
    right: ['pr_create', 'approve'],
    open: 'approval_pr',
    verb: 'raised',
    tail: ' — waiting for your approval',
    tone: 'due',
  },
  {
    entity: 'PurchaseRequest',
    action: 'APPROVE',
    right: ['po_create', 'entry'],
    open: 'pr_to_po',
    verb: 'approved',
    tail: ' — ready for a PO',
    tone: 'due',
  },
  {
    entity: 'PurchaseOrder',
    action: 'CREATE',
    right: ['po_create', 'approve'],
    open: 'approval_po',
    verb: 'raised',
    tail: ' — waiting for your approval',
    tone: 'due',
  },
  {
    entity: 'PurchaseOrder',
    action: 'APPROVE',
    right: ['ospdc_create', 'entry'],
    open: 'po_to_dc',
    verb: 'approved',
    tail: ' — material can be sent',
    tone: 'due',
  },
  {
    entity: 'PartyGrn',
    action: 'CREATE',
    right: ['qc_incoming', 'entry'],
    open: 'grn_qc',
    verb: 'received',
    tail: ' — waiting for Incoming QC',
    tone: 'due',
  },
  {
    entity: 'GoodsReceiptNote',
    action: 'CREATE',
    right: ['qc_incoming', 'entry'],
    open: 'grn_qc',
    verb: 'received',
    tail: ' — waiting for Incoming QC',
    tone: 'due',
  },
  {
    entity: 'SalesOrder',
    action: 'CREATE',
    right: ['plan_create', 'entry'],
    open: 'so_to_plan',
    verb: 'booked',
    tail: ' — to plan',
    tone: 'due',
  },
  {
    entity: 'JobWorkOrder',
    action: 'CREATE',
    right: ['plan_create', 'entry'],
    open: 'so_to_plan',
    verb: 'booked',
    tail: ' — to plan',
    tone: 'due',
  },
  {
    entity: 'Plan',
    action: 'CREATE',
    right: ['prodorder_create', 'entry'],
    open: 'plan_to_pro',
    verb: 'planned',
    tail: ' — ready for a Production Order',
    tone: 'due',
  },
  {
    entity: 'JobCard',
    action: 'QC',
    right: ['op_entry', 'entry'],
    open: 'ops_ready',
    verb: 'accepted',
    tail: ' — next op can start',
    tone: 'ok',
    opQc: true,
  },
  {
    entity: 'PurchaseRequest',
    action: 'REJECT',
    right: ['pr_create', 'entry'],
    open: 'raiser_pr',
    verb: 'rejected',
    tail: ' — your request',
    tone: 'late',
  },
  {
    entity: 'PurchaseOrder',
    action: 'REJECT',
    right: ['po_create', 'entry'],
    open: 'raiser_po',
    verb: 'rejected',
    tail: ' — your order',
    tone: 'late',
  },
];

/** "<actor> raised " / "<actor> accepted 20 on " — the words before the number. */
export function noteLead(ev: ActivityEvent, rule: NoteRule): string {
  if (rule.opQc) return `${ev.actor} ${rule.verb} ${Number(ev.qty ?? 0)} on `;
  return `${ev.actor} ${rule.verb} `;
}

export function noteRuleFor(entity: string, action: string): NoteRule | undefined {
  return NOTE_RULES.find((r) => r.entity === entity && r.action === action);
}

/** The rules this caller can receive. Admins / Full Access: none. */
export function rulesFor(a: DashAccess): NoteRule[] {
  if (a.isAdmin || a.eff.fullAccess) return [];
  return NOTE_RULES.filter((r) => hasTick(a, r.right[0], r.right[1]));
}

export interface ActivityEvent {
  id: string;
  ts: Date;
  entity: string;
  action: string;
  entityId: string;
  refId: string;
  userId: string;
  actor: string;
  /** activity_log.qty — for JobCard QC the ACCEPTED qty (op-entry writes
   *  input.qty, the accepted pieces; rejects ride only in the detail). */
  qty: number | null;
  opRef: string | null;
}

/** Events that become candidate notes: a held rule, not the caller's own. */
export function candidates(
  events: readonly ActivityEvent[],
  rules: readonly NoteRule[],
  me: string,
): Array<{ ev: ActivityEvent; rule: NoteRule }> {
  const out: Array<{ ev: ActivityEvent; rule: NoteRule }> = [];
  for (const ev of events) {
    if (ev.userId === me) continue;
    const rule = rules.find((r) => r.entity === ev.entity && r.action === ev.action);
    if (!rule) continue;
    if (rule.opQc && (!ev.opRef || !(Number(ev.qty) > 0))) continue;
    out.push({ ev, rule });
  }
  return out;
}

async function openIds(
  tx: DbTransaction,
  open: Open,
  ids: string[],
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
): Promise<Set<string>> {
  if (open === 'approval_pr') return new Set((approvals?.pr ?? []).map((r) => r.id));
  if (open === 'approval_po') return new Set((approvals?.po ?? []).map((r) => r.id));
  if (open === 'raiser_pr' || open === 'raiser_po') {
    const table =
      open === 'raiser_pr'
        ? sql.raw('public.purchase_requests')
        : sql.raw('public.purchase_orders');
    const rows = (await tx.execute(sql`
      SELECT d.id::text AS id FROM ${table} d
      WHERE d.company_id = ${c.cid}::uuid AND d.deleted_at IS NULL AND d.created_by = ${me}::uuid
        AND d.id = ANY(${sql.param(ids)}::uuid[])
    `)) as unknown as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }
  const d = listDef(open)!;
  const { rows } = await runList(tx, d.query(c, { ids }), { ids, limit: 1000 });
  return new Set(rows.map((r) => r.id));
}

export async function buildNotifications(
  tx: DbTransaction,
  a: DashAccess,
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
): Promise<{ items: DashNote[]; unseen: number; seenAt: string | null }> {
  const seenAt = await readSeenAt(tx, c.cid, me);
  const rules = rulesFor(a);
  if (rules.length === 0) return { items: [], unseen: 0, seenAt };

  const pairs: SQL[] = rules.map((r) => sql`(${r.entity}::text, ${r.action}::text)`);
  const res = (await tx.execute(sql`
    SELECT a.id::text AS id, a.ts, a.entity, a.action, a.entity_id::text AS entity_id,
           a.ref_id, a.user_id::text AS user_id, a.qty, a.op_ref,
           COALESCE(u.full_name, a.user_full_name, a.user_name) AS actor
    FROM public.activity_log a
    LEFT JOIN public.users u ON u.id = a.user_id
    WHERE a.company_id = ${c.cid}::uuid
      AND a.user_id IS NOT NULL AND a.user_id <> ${me}::uuid
      AND a.entity_id IS NOT NULL AND a.ref_id IS NOT NULL
      AND a.ts >= ((${addDays(c.today, -(NOTE_DAYS - 1))}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (a.entity, a.action) IN (${sql.join(pairs, sql`, `)})
    ORDER BY a.ts DESC
    LIMIT 300
  `)) as unknown as Array<Record<string, unknown>>;
  const events: ActivityEvent[] = res.map((r) => ({
    id: String(r['id']),
    ts: r['ts'] instanceof Date ? r['ts'] : new Date(String(r['ts'])),
    entity: String(r['entity']),
    action: String(r['action']),
    entityId: String(r['entity_id']),
    refId: String(r['ref_id']),
    userId: String(r['user_id']),
    actor: str(r['actor']) ?? 'Someone',
    qty: r['qty'] === null || r['qty'] === undefined ? null : Number(r['qty']),
    opRef: str(r['op_ref']),
  }));
  const cands = candidates(events, rules, me);

  // One "still open?" read per kind of next step, over every candidate id.
  const byOpen = new Map<Open, Set<string>>();
  for (const { ev, rule } of cands) {
    const s = byOpen.get(rule.open) ?? new Set<string>();
    s.add(ev.entityId);
    byOpen.set(rule.open, s);
  }
  const stillOpen = new Map<Open, Set<string>>();
  for (const [open, ids] of byOpen)
    stillOpen.set(open, await openIds(tx, open, [...ids], c, me, approvals));

  const seenMs = seenAt ? Date.parse(seenAt) : NaN;
  const items: DashNote[] = cands
    .filter(({ ev, rule }) => stillOpen.get(rule.open)?.has(ev.entityId))
    .slice(0, NOTE_MAX)
    .map(({ ev, rule }) => ({
      key: ev.id,
      ts: ev.ts.toISOString(),
      tone: rule.tone,
      text: [
        { text: noteLead(ev, rule) },
        codePart(ev.refId, entityHref(ev.entity, ev.entityId, ev.refId)),
        { text: rule.tail },
      ],
      unseen: Number.isNaN(seenMs) || ev.ts.getTime() > seenMs,
    }));
  return { items, unseen: items.filter((n) => n.unseen).length, seenAt };
}

// ── Seen time ──
const ISO_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

export async function readSeenAt(
  tx: DbTransaction,
  cid: string,
  me: string,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT s.setting_value FROM public.user_ui_settings s
    WHERE s.company_id = ${cid}::uuid AND s.user_id = ${me}::uuid
      AND s.setting_key = ${NOTIFICATIONS_SEEN_KEY} AND s.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ setting_value: string }>;
  const v = rows[0]?.setting_value ?? null;
  return v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
}

/** ONE statement: insert, or keep the LATER of the stored and the sent time.
 *  The sent time is capped at the server's now, so a wrong clock in the
 *  browser cannot mark future notes as seen. */
export function markSeenSql(cid: string, me: string, sentAt: string): SQL {
  const fmt = sql.raw(ISO_FMT);
  return sql`
    INSERT INTO public.user_ui_settings
      (company_id, user_id, setting_key, setting_value, created_by, updated_by)
    VALUES (${cid}::uuid, ${me}::uuid, ${NOTIFICATIONS_SEEN_KEY},
            to_char(LEAST(${sentAt}::timestamptz, now()) AT TIME ZONE 'UTC', ${fmt}),
            ${me}::uuid, ${me}::uuid)
    ON CONFLICT (company_id, user_id, setting_key) WHERE deleted_at IS NULL
    DO UPDATE SET
      setting_value = to_char(GREATEST(user_ui_settings.setting_value::timestamptz,
                                       excluded.setting_value::timestamptz) AT TIME ZONE 'UTC', ${fmt}),
      updated_by = excluded.updated_by,
      updated_at = now()
    RETURNING setting_value`;
}
