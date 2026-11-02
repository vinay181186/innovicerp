// ADR-250 — dashboard-only notifications (no email). A note is someone ELSE's
// activity (last 3 India-time days) whose next step is a right the caller
// holds, kept only while that step is still open — asked of the same query
// the matching home list uses (or the approvals inbox for approvals). The
// rules are note-rules.ts.
//
// Owner rules 2-Nov-2026: Super Admin / Full Access get every rule; a
// decision goes ONLY to the document's raiser, also when they decided it
// themselves (raiser rules + decision-notes.ts); new-work notes for
// documents with no activity row come from work-notes.ts.
//
// ADR-255 — plus Day Log replies (day-log-replies.ts): first, for every
// caller, until the entry is opened; outside the window and the cap.
//
// The "seen" time is the caller's own user_ui_settings row; it only ever
// moves forward (GREATEST in one statement) and never past the server's now.

import type { ApprovalInboxResponse, DashNote } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { type DashAccess, hasTick } from '../access';
import { dayLogReplyNote, readDayLogReplies } from './day-log-replies';
import { type ExtraNote, readDecisionNotes } from './decision-notes';
import { APPROVAL_DEFS, type ListCtx, listDef } from './lists';
import { runList } from './list-query';
import {
  NOTE_RULES,
  type NoteRule,
  type Open,
  RC_TO_PENDING_CHANGE,
  noteHref,
  openSql,
  othersTail,
  raiserNameSql,
  ruleCond,
  ruleId,
  rulesFor,
  seesAll,
} from './note-rules';
import { addDays, codePart, str } from './util';
import { readWorkNotes } from './work-notes';

export const NOTIFICATIONS_SEEN_KEY = 'notifications_seen_at';
const NOTE_DAYS = 3;
const NOTE_MAX = 50;

export { NOTE_RULES, rulesFor, type NoteRule } from './note-rules';
export type { ExtraNote } from './decision-notes';

/** Next steps where one note per document is enough: a card created,
 *  rejected, resubmitted and restored inside the window is still ONE card
 *  waiting — only its newest event shows. */
const ONE_NOTE_PER_DOC: ReadonlySet<Open> = new Set<Open>([
  'approval_rc',
  'raiser_rc',
  'raiser_rc_approved',
]);

/** "<actor> raised " / "<actor> accepted 20 on " — the words before the number. */
export function noteLead(ev: ActivityEvent, rule: NoteRule): string {
  if (rule.opQc) return `${ev.actor} ${rule.verb} ${Number(ev.qty ?? 0)} on `;
  return `${ev.actor} ${rule.verb} `;
}

export function noteRuleFor(entity: string, action: string): NoteRule | undefined {
  return NOTE_RULES.find((r) => r.entity === entity && r.action === action);
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
  /** The rules (ruleId) whose full condition the activity read matched —
   *  changesHas / when / raiser are SQL-only, so an event read from the
   *  database carries this; absent = only the in-memory checks apply. */
  ruleKeys?: readonly string[];
  /** Owner rule 1 — a raiser rule's document belongs to this person, not to
   *  the caller (set only for a caller who sees all). */
  raiserName?: string | null;
}

/** Events that become candidate notes: a held rule, not the caller's own
 *  (except a raiser rule — owner rule 3: the raiser's own decision still
 *  notes them). One event can feed several next steps (a QC entry: next op
 *  can start AND upload its report) — one note per held rule, keyed `<event
 *  id>:<next step>`. The key never depends on which of the caller's rules
 *  matched first, so a rights change does not re-key a note and its
 *  notification_reads row keeps matching (ADR-264). */
export function candidates(
  events: readonly ActivityEvent[],
  rules: readonly NoteRule[],
  me: string,
): Array<{ ev: ActivityEvent; rule: NoteRule; key: string }> {
  const out: Array<{ ev: ActivityEvent; rule: NoteRule; key: string }> = [];
  for (const ev of events) {
    for (const rule of rules) {
      if (rule.entity !== ev.entity || rule.action !== ev.action) continue;
      if (ev.userId === me && !rule.raiser) continue;
      if (ev.ruleKeys && !ev.ruleKeys.includes(ruleId(rule))) continue;
      if (rule.opQc && (!ev.opRef || !(Number(ev.qty) > 0))) continue;
      if (rule.toPending && !ev.toPending) continue;
      out.push({ ev, rule, key: `${ev.id}:${rule.open}` });
    }
  }
  return out;
}

/** ADR-264 — the caller's PO approvals inbox ids (purchase-orders
 *  listPoApprovalInbox: Approve tick, approver list, approval ceiling, own POs
 *  at any value), for a caller that has not loaded the whole inbox. */
export type PoInboxIds = (tx: DbTransaction) => Promise<Set<string>>;

async function openIds(
  tx: DbTransaction,
  open: Open,
  ids: string[],
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
  poInbox?: PoInboxIds,
  seeAll = false,
): Promise<Set<string>> {
  // Owner rule 1: a caller who sees all keeps someone else's document too.
  const mine = seeAll ? sql`` : sql`AND d.created_by = ${me}::uuid`;
  // The home has the approvals inbox already. The bell does not load it: it
  // asks the PO inbox's own rule (poInbox) so "waiting for your approval"
  // matches the inbox, else the "waiting for approval" list's query.
  if (open === 'approval_po' && approvals) return new Set((approvals.po ?? []).map((r) => r.id));
  if (open === 'approval_po' && poInbox) return poInbox(tx);
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
      WHERE d.company_id = ${c.cid}::uuid AND d.deleted_at IS NULL ${mine}
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
      WHERE d.company_id = ${c.cid}::uuid AND d.deleted_at IS NULL ${mine}
        AND d.approval_status = ${status}
        AND d.id = ANY(${sql.param(ids)}::uuid[])
    `)) as unknown as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }
  const own = openSql(open, c.cid, me, ids, seeAll);
  if (own) {
    const rows = (await tx.execute(own)) as unknown as Array<{ id: string }>;
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
  const own = open ? rule.tail : (rule.doneTail ?? '');
  // Owner rule 1: someone else's document reads with its raiser's name.
  const tail = rule.raiser && ev.raiserName ? othersTail(own, ev.raiserName) : own;
  return [
    { text: noteLead(ev, rule) },
    codePart(rule.refLabel?.(ev.refId) ?? ev.refId, noteHref(ev.entity, ev.entityId, ev.refId)),
    ...(tail ? [{ text: tail }] : []),
    ...(rule.withReason && ev.reason ? [{ text: ` · ${ev.reason}` }] : []),
  ];
}

/** One "still open?" read per kind of next step, over every candidate id —
 *  the kinds are independent, so they run together (postgres-js queues them
 *  on the transaction's one connection; no second pool connection). */
export async function openSets(
  tx: DbTransaction,
  cands: readonly NoteCandidate[],
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
  poInbox?: PoInboxIds,
  seeAll = false,
): Promise<Map<Open, Set<string>>> {
  const byOpen = new Map<Open, Set<string>>();
  for (const { ev, rule } of cands) {
    const s = byOpen.get(rule.open) ?? new Set<string>();
    s.add(ev.entityId);
    byOpen.set(rule.open, s);
  }
  const entries = await Promise.all(
    [...byOpen].map(
      async ([open, ids]) =>
        [open, await openIds(tx, open, [...ids], c, me, approvals, poInbox, seeAll)] as const,
    ),
  );
  return new Map(entries);
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

/** The window's first instant: India-time midnight `days - 1` days back. */
export const windowStart = (today: string, days: number): SQL =>
  sql`((${addDays(today, -(days - 1))}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')`;

/** ONE activity read for every rule the caller holds: each row carries the
 *  ids of the rules whose FULL condition it meets (ruleCond — the raiser /
 *  own-event / changes / when parts are SQL), and only rows meeting one are
 *  kept. Newest first, `scan` rows at most. */
export function activityReadSql(
  rules: readonly NoteRule[],
  cid: string,
  me: string,
  since: SQL,
  scan: number,
  seeAll = false,
): SQL {
  const pairs = rules.map((r) => sql`(a.entity = ${r.entity} AND a.action = ${r.action})`);
  const keys = rules.map(
    (r) => sql`CASE WHEN ${ruleCond(r, cid, me, seeAll)} THEN ${ruleId(r)} END`,
  );
  // Cheap first: the window and the entity + action pairs filter the log in
  // the innermost WHERE, so the per-rule CASE (EXISTS) runs only on rows of a
  // held entity + action; the raiser's name is read last, on the LIMITed rows.
  return sql`
    SELECT ev.*, ${seeAll ? raiserNameSql(me, 'ev') : sql`NULL::text`} AS raiser_name
    FROM (
      SELECT k.* FROM (
        SELECT a.id::text AS id, a.ts, a.entity, a.action, a.entity_id::text AS entity_id,
               a.ref_id, a.user_id::text AS user_id, a.qty, a.op_ref, a.reason,
               COALESCE(a.changes @> ${RC_TO_PENDING_CHANGE}::jsonb, false) AS to_pending,
               array_remove(ARRAY[${sql.join(keys, sql`, `)}]::text[], NULL) AS rule_keys,
               COALESCE(u.full_name, a.user_full_name, a.user_name) AS actor
        FROM public.activity_log a
        LEFT JOIN public.users u ON u.id = a.user_id
        WHERE a.company_id = ${cid}::uuid
          AND a.ts >= ${since}
          AND (${sql.join(pairs, sql` OR `)})
          AND a.user_id IS NOT NULL
          AND a.entity_id IS NOT NULL AND a.ref_id IS NOT NULL
      ) k
      WHERE cardinality(k.rule_keys) > 0
      ORDER BY k.ts DESC
      LIMIT ${scan}
    ) ev
    ORDER BY ev.ts DESC`;
}

/** The caller's Day Log reply notes, decision / work notes (worded), seen
 *  time and candidate events (newest first, not yet filtered by "still
 *  open"). */
export async function readNoteCandidates(
  tx: DbTransaction,
  a: DashAccess,
  c: ListCtx,
  me: string,
  opts: NoteOptions = {},
): Promise<{
  replyNotes: NoteWithActor[];
  extraNotes: ExtraNote[];
  cands: NoteCandidate[];
  seenAt: string | null;
}> {
  const days = opts.days ?? NOTE_DAYS;
  const scan = opts.scan ?? 300;
  const since = windowStart(c.today, days);
  const seenAt = await readSeenAt(tx, c.cid, me);
  // Owner 2026-10-30: Day Log hidden ("Hide page") → no Day Log reply notes.
  const replyNotes: NoteWithActor[] = hasTick(a, 'daylog_view', 'view')
    ? (await readDayLogReplies(tx, c.cid, me)).map((r) => ({
        ...dayLogReplyNote(r),
        actorName: r.author,
      }))
    : [];
  // Each source in its own savepoint, one after another (guardedRead): a
  // failing source drops only itself.
  const decisions = await readDecisionNotes(tx, c.cid, me, since, seesAll(a));
  const work = await readWorkNotes(tx, a, c.cid, me, since, seesAll(a));
  const extraNotes = [...decisions, ...work].sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts));
  const rules = rulesFor(a);
  if (rules.length === 0) return { replyNotes, extraNotes, cands: [], seenAt };
  const seeAll = seesAll(a);

  const res = (await tx.execute(
    activityReadSql(rules, c.cid, me, since, scan, seeAll),
  )) as unknown as Array<Record<string, unknown>>;
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
    ruleKeys: Array.isArray(r['rule_keys']) ? (r['rule_keys'] as unknown[]).map(String) : [],
    raiserName: str(r['raiser_name']),
  }));
  return { replyNotes, extraNotes, cands: candidates(events, rules, me), seenAt };
}

/** ADR-250 home block: notes whose next step is still open, newest first
 *  (Day Log replies first, outside the cap). */
export async function buildNotifications(
  tx: DbTransaction,
  a: DashAccess,
  c: ListCtx,
  me: string,
  approvals: ApprovalInboxResponse | null,
  opts: NoteOptions = {},
): Promise<{ items: NoteWithActor[]; unseen: number; seenAt: string | null }> {
  const noteMax = opts.max ?? NOTE_MAX;
  const { replyNotes, extraNotes, cands, seenAt } = await readNoteCandidates(tx, a, c, me, opts);
  const stillOpen = cands.length
    ? await openSets(tx, cands, c, me, approvals, undefined, seesAll(a))
    : new Map<Open, Set<string>>();

  const seenMs = seenAt ? Date.parse(seenAt) : NaN;
  const isUnseen = (ts: string): boolean => Number.isNaN(seenMs) || Date.parse(ts) > seenMs;
  const fromEvents: NoteWithActor[] = onePerDoc(cands.filter((x) => isStillOpen(stillOpen, x))).map(
    ({ ev, rule, key }) => ({
      key,
      ts: ev.ts.toISOString(),
      tone: rule.tone,
      actorName: ev.actor,
      text: noteText(ev, rule, true),
      unseen: false,
    }),
  );
  const fromExtras: NoteWithActor[] = extraNotes
    .filter((n) => n.open)
    .map(({ open: _open, ...n }) => n);
  const items = [...fromEvents, ...fromExtras]
    .sort((x, y) => Date.parse(y.ts) - Date.parse(x.ts))
    .slice(0, Math.max(0, noteMax - replyNotes.length))
    .map((n) => ({ ...n, unseen: isUnseen(n.ts) }));
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
