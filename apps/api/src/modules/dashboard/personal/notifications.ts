// ADR-250 — dashboard-only notifications (no email). A note is someone ELSE's
// activity (last 3 India-time days) whose next step is a right the caller
// holds, kept only while that step is still open — asked of the same query
// the matching home list uses (or the approvals inbox for approvals). Full
// Access / role admin callers get none (owner decision).
//
// ADR-255 — plus Day Log replies (day-log-replies.ts): first, for every
// caller, until the entry is opened; outside the window and the cap.
//
// The "seen" time is the caller's own user_ui_settings row; it only ever
// moves forward (GREATEST in one statement) and never past the server's now.

import {
  type AccessAction,
  type AccessFormKey,
  type ApprovalInboxResponse,
  type DashNote,
  type DashTone,
  ROUTE_CARD_APPROVAL_LABEL,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { type DashAccess, hasTick } from '../access';
import { dayLogReplyNote, readDayLogReplies } from './day-log-replies';
import { APPROVAL_DEFS, type ListCtx, listDef } from './lists';
import { runList } from './list-query';
import { addDays, codePart, entityHref, str } from './util';

export const NOTIFICATIONS_SEEN_KEY = 'notifications_seen_at';
const NOTE_DAYS = 3;
const NOTE_MAX = 50;

type Open =
  | 'approval_po'
  | 'approval_rc'
  | 'raiser_pr'
  | 'raiser_po'
  | 'raiser_rc'
  | 'raiser_rc_approved'
  | 'pr_to_po'
  | 'po_to_dc'
  | 'grn_qc'
  | 'so_to_plan'
  | 'plan_to_pro'
  | 'ops_ready'
  | 'qc_report_missing';

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
  /** ADR-253 — only an event whose `changes` move RC Status to Pending
   *  Approval (a Rejected card saved again). Other edits of the same entity
   *  are not a "waiting for your approval" event. */
  toPending?: true;
  /** Show the activity's reason after the tail (a Route Card rejection). */
  withReason?: true;
  /** ADR-264 bell — the tail once the next step is no longer open. Absent =
   *  no tail: a call to action ("— waiting for your approval") is dropped,
   *  leaving the plain past fact ("Jinal raised IN-PO-0421"). */
  doneTail?: string;
}

/** ADR-253 — the one `changes` entry a resubmitted Route Card's EDIT carries
 *  (route-cards/service.ts rcStatusChange('rejected', 'pending')). */
const RC_TO_PENDING_CHANGE = JSON.stringify([
  { field: 'approvalStatus', after: ROUTE_CARD_APPROVAL_LABEL.pending },
]);

/** Next steps where one note per document is enough: a card created,
 *  rejected, resubmitted and restored inside the window is still ONE card
 *  waiting — only its newest event shows. */
const ONE_NOTE_PER_DOC: ReadonlySet<Open> = new Set<Open>([
  'approval_rc',
  'raiser_rc',
  'raiser_rc_approved',
]);

// Entity / action strings as each writer emits them (activity_log).
export const NOTE_RULES: readonly NoteRule[] = [
  {
    // PRs have no approval (owner rule 2026-10-31): a new PR is ready for a
    // PO at once, so the PO creators hear of it — kept while it is still on
    // the "PRs to order" list (pr_to_po).
    entity: 'PurchaseRequest',
    action: 'CREATE',
    right: ['po_create', 'entry'],
    open: 'pr_to_po',
    verb: 'raised',
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
    // ADR-253 — a new Route Card (RC screen, or one a Job Card / plan made).
    entity: 'RouteCard',
    action: 'CREATE',
    right: ['routecard_create', 'approve'],
    open: 'approval_rc',
    verb: 'created',
    tail: ' — waiting for your approval',
    tone: 'due',
  },
  {
    // ADR-253 — a Rejected card corrected and saved again is back to Pending
    // Approval: the approvers are told again.
    entity: 'RouteCard',
    action: 'EDIT',
    right: ['routecard_create', 'approve'],
    open: 'approval_rc',
    verb: 'sent again',
    tail: ' — waiting for your approval',
    tone: 'due',
    toPending: true,
  },
  {
    // ADR-253 — a card restored from Trash comes back Pending Approval.
    entity: 'RouteCard',
    action: 'RESTORE',
    right: ['routecard_create', 'approve'],
    open: 'approval_rc',
    verb: 'restored',
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
    // ADR-252 — the same QC activity, for whoever uploads QC reports: kept
    // only while that job card still has an entry without its report
    // (the qc_report_missing list's own query answers "still open?").
    entity: 'JobCard',
    action: 'QC',
    right: ['qcdocs_upload', 'entry'],
    open: 'qc_report_missing',
    verb: 'accepted',
    tail: ' — upload the QC report',
    tone: 'due',
    opQc: true,
  },
  {
    entity: 'PurchaseRequest',
    action: 'REJECT',
    right: ['pr_create', 'entry'],
    open: 'raiser_pr',
    verb: 'rejected',
    tail: ' — your request',
    doneTail: ' — your request',
    tone: 'late',
  },
  {
    entity: 'PurchaseOrder',
    action: 'REJECT',
    right: ['po_create', 'entry'],
    open: 'raiser_po',
    verb: 'rejected',
    tail: ' — your order',
    doneTail: ' — your order',
    tone: 'late',
  },
  {
    // ADR-253 — the creator hears the decision on their Route Card. 'view' is
    // the right: a card born from a Job Card / plan has a creator who may only
    // view Route Cards, and viewing it is all the note asks of them.
    entity: 'RouteCard',
    action: 'REJECT',
    right: ['routecard_create', 'view'],
    open: 'raiser_rc',
    verb: 'rejected',
    tail: ' — your Route Card',
    doneTail: ' — your Route Card',
    tone: 'late',
    withReason: true,
  },
  {
    entity: 'RouteCard',
    action: 'APPROVE',
    right: ['routecard_create', 'view'],
    open: 'raiser_rc_approved',
    verb: 'approved',
    tail: ' — your Route Card can be used now',
    doneTail: ' — your Route Card',
    tone: 'ok',
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
  /** The activity's `changes` move RC Status to Pending Approval (see
   *  NoteRule.toPending). */
  toPending?: boolean;
  /** activity_log.reason (a rejection's reason). */
  reason?: string | null;
}

/** Events that become candidate notes: a held rule, not the caller's own.
 *  One event can feed several next steps (a QC entry: next op can start AND
 *  upload its report) — one note per held rule, keyed `<event id>:<next
 *  step>`. The key never depends on which of the caller's rules matched
 *  first, so a rights change does not re-key a note and its
 *  notification_reads row keeps matching (ADR-264). */
export function candidates(
  events: readonly ActivityEvent[],
  rules: readonly NoteRule[],
  me: string,
): Array<{ ev: ActivityEvent; rule: NoteRule; key: string }> {
  const out: Array<{ ev: ActivityEvent; rule: NoteRule; key: string }> = [];
  for (const ev of events) {
    if (ev.userId === me) continue;
    for (const rule of rules) {
      if (rule.entity !== ev.entity || rule.action !== ev.action) continue;
      if (rule.opQc && (!ev.opRef || !(Number(ev.qty) > 0))) continue;
      if (rule.toPending && !ev.toPending) continue;
      out.push({ ev, rule, key: `${ev.id}:${rule.open}` });
    }
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
  // The home has the approvals inbox already. The bell does not load it: it
  // asks the "waiting for approval" list's own query instead (wording only).
  if (open === 'approval_po' && approvals) return new Set((approvals.po ?? []).map((r) => r.id));
  if (open === 'approval_rc' && approvals) return new Set((approvals.rc ?? []).map((r) => r.id));
  if (open === 'approval_po' || open === 'approval_rc') {
    const d = APPROVAL_DEFS[open === 'approval_po' ? 'po_draft' : 'rc_pending'];
    const { rows } = await runList(tx, d.query(c, { ids }), { ids, limit: 1000 });
    return new Set(rows.map((r) => r.id));
  }
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
  if (open === 'raiser_rc' || open === 'raiser_rc_approved') {
    // Still the caller's card, and still in the state the note announces — a
    // rejection is dropped once the card is sent again (or approved).
    const status = open === 'raiser_rc' ? 'rejected' : 'approved';
    const rows = (await tx.execute(sql`
      SELECT d.id::text AS id FROM public.route_cards d
      WHERE d.company_id = ${c.cid}::uuid AND d.deleted_at IS NULL AND d.created_by = ${me}::uuid
        AND d.approval_status = ${status}
        AND d.id = ANY(${sql.param(ids)}::uuid[])
    `)) as unknown as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }
  const d = listDef(open)!;
  const { rows } = await runList(tx, d.query(c, { ids }), { ids, limit: 1000 });
  return new Set(rows.map((r) => r.id));
}

/** ADR-264 — the bell reads the same notes over a longer window, as a history
 *  (readNoteCandidates + bellCandidates + noteText). Defaults = the ADR-250
 *  home block. */
export interface NoteOptions {
  days?: number;
  /** Most notes kept (home: NOTE_MAX). */
  max?: number;
  /** Most activity rows read (home: 300). */
  scan?: number;
}

/** A note plus who did it (the bell's initials circle). The home response
 *  schema strips actorName. */
export type NoteWithActor = DashNote & { actorName: string | null };

export interface NoteCandidate {
  ev: ActivityEvent;
  rule: NoteRule;
  key: string;
}

/** The note's words. `open` = its next step is still open: the rule's tail
 *  (the call to action). Not open: the past fact — doneTail, or no tail. */
export function noteText(ev: ActivityEvent, rule: NoteRule, open: boolean): DashNote['text'] {
  const tail = open ? rule.tail : (rule.doneTail ?? '');
  return [
    { text: noteLead(ev, rule) },
    codePart(ev.refId, entityHref(ev.entity, ev.entityId, ev.refId)),
    ...(tail ? [{ text: tail }] : []),
    ...(rule.withReason && ev.reason ? [{ text: ` — ${ev.reason}` }] : []),
  ];
}

/** One "still open?" read per kind of next step, over every candidate id. */
export async function openSets(
  tx: DbTransaction,
  cands: readonly NoteCandidate[],
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
): Promise<Map<Open, Set<string>>> {
  const byOpen = new Map<Open, Set<string>>();
  for (const { ev, rule } of cands) {
    const s = byOpen.get(rule.open) ?? new Set<string>();
    s.add(ev.entityId);
    byOpen.set(rule.open, s);
  }
  const out = new Map<Open, Set<string>>();
  for (const [open, ids] of byOpen) {
    out.set(open, await openIds(tx, open, [...ids], c, me, approvals));
  }
  return out;
}

/** True when this candidate's next step is in the open sets. */
export const isStillOpen = (sets: ReadonlyMap<Open, Set<string>>, cand: NoteCandidate): boolean =>
  sets.get(cand.rule.open)?.has(cand.ev.entityId) ?? false;

/** Keep one note per document where one is enough (ONE_NOTE_PER_DOC). Events
 *  arrive newest first, so the note kept per document is the newest. */
function onePerDoc(cands: readonly NoteCandidate[]): NoteCandidate[] {
  const seen = new Set<string>();
  return cands.filter(({ ev, rule }) => {
    if (!ONE_NOTE_PER_DOC.has(rule.open)) return true;
    const k = `${rule.open}:${ev.entityId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The caller's Day Log reply notes, seen time and candidate events (newest
 *  first, not yet filtered by "still open"). */
export async function readNoteCandidates(
  tx: DbTransaction,
  a: DashAccess,
  c: ListCtx,
  me: string,
  opts: NoteOptions = {},
): Promise<{ replyNotes: NoteWithActor[]; cands: NoteCandidate[]; seenAt: string | null }> {
  const days = opts.days ?? NOTE_DAYS;
  const scan = opts.scan ?? 300;
  const seenAt = await readSeenAt(tx, c.cid, me);
  // Owner 2026-10-30: Day Log hidden ("Hide page") → no Day Log reply notes.
  const replyNotes: NoteWithActor[] = hasTick(a, 'daylog_view', 'view')
    ? (await readDayLogReplies(tx, c.cid, me)).map((r) => ({
        ...dayLogReplyNote(r),
        actorName: r.author,
      }))
    : [];
  const rules = rulesFor(a);
  if (rules.length === 0) return { replyNotes, cands: [], seenAt };

  const toPendingSql = sql`COALESCE(a.changes @> ${RC_TO_PENDING_CHANGE}::jsonb, false)`;
  const pairs: SQL[] = rules.map((r) =>
    r.toPending
      ? sql`(a.entity = ${r.entity} AND a.action = ${r.action} AND ${toPendingSql})`
      : sql`(a.entity = ${r.entity} AND a.action = ${r.action})`,
  );
  const res = (await tx.execute(sql`
    SELECT a.id::text AS id, a.ts, a.entity, a.action, a.entity_id::text AS entity_id,
           a.ref_id, a.user_id::text AS user_id, a.qty, a.op_ref, a.reason,
           ${toPendingSql} AS to_pending,
           COALESCE(u.full_name, a.user_full_name, a.user_name) AS actor
    FROM public.activity_log a
    LEFT JOIN public.users u ON u.id = a.user_id
    WHERE a.company_id = ${c.cid}::uuid
      AND a.user_id IS NOT NULL AND a.user_id <> ${me}::uuid
      AND a.entity_id IS NOT NULL AND a.ref_id IS NOT NULL
      AND a.ts >= ((${addDays(c.today, -(days - 1))}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (${sql.join(pairs, sql` OR `)})
    ORDER BY a.ts DESC
    LIMIT ${scan}
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
    toPending: r['to_pending'] === true,
    reason: str(r['reason']),
  }));
  return { replyNotes, cands: candidates(events, rules, me), seenAt };
}

/** ADR-250 home block: notes whose next step is still open, newest first. */
export async function buildNotifications(
  tx: DbTransaction,
  a: DashAccess,
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
  opts: NoteOptions = {},
): Promise<{ items: NoteWithActor[]; unseen: number; seenAt: string | null }> {
  const noteMax = opts.max ?? NOTE_MAX;
  const { replyNotes, cands, seenAt } = await readNoteCandidates(tx, a, c, me, opts);
  if (cands.length === 0) return { items: replyNotes, unseen: replyNotes.length, seenAt };
  const stillOpen = await openSets(tx, cands, c, me, approvals);

  const seenMs = seenAt ? Date.parse(seenAt) : NaN;
  const items: NoteWithActor[] = onePerDoc(cands.filter((x) => isStillOpen(stillOpen, x)))
    .slice(0, Math.max(0, noteMax - replyNotes.length))
    .map(({ ev, rule, key }) => ({
      key,
      ts: ev.ts.toISOString(),
      tone: rule.tone,
      actorName: ev.actor,
      text: noteText(ev, rule, true),
      unseen: Number.isNaN(seenMs) || ev.ts.getTime() > seenMs,
    }));
  const unseen = replyNotes.length + items.filter((n) => n.unseen).length;
  return { items: [...replyNotes, ...items], unseen, seenAt };
}

/** ADR-264 bell: every note in the window as a history (no "still open"
 *  filter), one per document where one is enough, capped at `max`. Text is
 *  NOT built here — the caller words only the notes it shows (openSets +
 *  noteText), so a 6-row popover never words 1,000 notes. */
export function bellCandidates(cands: readonly NoteCandidate[], max: number): NoteCandidate[] {
  return onePerDoc(cands).slice(0, Math.max(0, max));
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
