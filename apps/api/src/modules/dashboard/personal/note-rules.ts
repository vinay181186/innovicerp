// ADR-250 / ADR-264 — the activity-log note rules: which event (entity +
// action, as each writer emits it) tells whom about which next step. Split
// out of notifications.ts (the reader / wording) so each file stays readable.
//
// Owner rules 2-Nov-2026:
//   1. Super Admin / Full Access get EVERY rule (rulesFor).
//   2. A decision on a document goes to the person who raised it — ONLY to
//      them (a `raiser` rule: the activity read joins the document's own
//      created_by / user_id = caller), and whatever their department rights.
//   3. A raiser who decided it themselves still gets the decision note — the
//      one exception to "your own actions are never notes".
//   4. New work for a department: NC raised, NC → Return to Vendor, Stock
//      Count submitted (rights-gated like the rest).

import {
  type AccessAction,
  type AccessFormKey,
  type DashTone,
  NC_DISPOSITION_LABELS,
  PO_TYPES,
  poSendsMaterialOut,
  ROUTE_CARD_APPROVAL_LABEL,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { rtvReadyForChallanSql } from '../../../lib/rtv-predicates';
import { type DashAccess, hasTick } from '../access';
import { entityHref } from './util';

export type Open =
  | 'approval_po'
  | 'approval_rc'
  | 'raiser_pr'
  | 'raiser_po'
  | 'raiser_po_approved'
  | 'raiser_rc'
  | 'raiser_rc_approved'
  | 'raiser_stock_count'
  | 'raiser_day_log'
  | 'pr_to_po'
  | 'po_to_dc'
  | 'grn_qc'
  | 'so_to_plan'
  | 'plan_to_pro'
  | 'ops_ready'
  | 'qc_report_missing'
  | 'nc_dispose'
  | 'nc_rtv_dc'
  | 'stock_count_approve';

/** The document a raiser rule's note belongs to: its table and the column
 *  naming its person (created_by, or the Day Log's owner). */
interface RaiserOf {
  table: string;
  owner: 'created_by' | 'user_id';
  /** Still needs `right` (Day Log: no notes once the page is hidden — the
   *  same owner rule 2026-10-30 as the Day Log reply notes). */
  needsRight?: true;
}

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
  /** Only events whose `changes` contain this JSON (activity_log.changes @>).
   *  A staged edit's APPROVE / REJECT (document-edits) is written on the same
   *  entity; this keeps it out — it has its own decision note. */
  changesHas?: string;
  /** Only events whose `changes` do NOT contain this JSON (ADR-277: an old row
   *  with no `changes` still passes). */
  changesLacks?: string;
  /** Extra condition on the activity row `a` (company `cid`). */
  when?: (cid: string) => SQL;
  /** Owner rule 2 — delivered only to the document's raiser (see RaiserOf). */
  raiser?: RaiserOf;
  /** Show the activity's reason after the tail (a rejection). */
  withReason?: true;
  /** How the document number reads (Day Log: its date). Default: ref_id. */
  refLabel?: (refId: string) => string;
  /** ADR-264 bell — the tail once the next step is no longer open. Absent =
   *  no tail: a call to action ("— waiting for your approval") is dropped,
   *  leaving the plain past fact ("Jinal raised IN-PO-0421"). */
  doneTail?: string;
}

/** ADR-253 — the one `changes` entry a resubmitted Route Card's EDIT carries
 *  (route-cards/service.ts rcStatusChange('rejected', 'pending')). */
export const RC_TO_PENDING_CHANGE = JSON.stringify([
  { field: 'approvalStatus', after: ROUTE_CARD_APPROVAL_LABEL.pending },
]);

/** ADR-277 — a Route Card CREATE / RESTORE row that left it a Draft (not on any
 *  approver's list, so no bell). rcStatusChange(null, 'draft'). */
const RC_TO_DRAFT_CHANGE = JSON.stringify([
  { field: 'approvalStatus', after: ROUTE_CARD_APPROVAL_LABEL.draft },
]);

/** approvePurchaseOrder / rejectPurchaseOrder: PO Status from Draft (the same
 *  filter approvals/history.ts uses). */
const PO_DECISION = JSON.stringify([{ field: 'status', before: 'Draft' }]);
/** approveRouteCard / rejectRouteCard: RC Status change. */
const RC_DECISION = JSON.stringify([{ field: 'approvalStatus' }]);
/** The retired PR reject wrote a status change; a staged PR edit's REJECT does not. */
const PR_DECISION = JSON.stringify([{ field: 'status' }]);
/** nc-register disposeNc — the disposition chosen was Return to Vendor. */
const NC_TO_RTV = JSON.stringify([
  { field: 'disposition', after: NC_DISPOSITION_LABELS.return_to_vendor },
]);

/** PO types whose approval means material goes out (the po_to_dc list's rule). */
const SEND_OUT_TYPES = PO_TYPES.filter((t) => poSendsMaterialOut(t));

const dmy = (d: string): string => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

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
    changesLacks: RC_TO_DRAFT_CHANGE,
  },
  {
    // ADR-253 / ADR-277 — a Draft or Rejected card sent for approval: the
    // approvers are told.
    entity: 'RouteCard',
    action: 'EDIT',
    right: ['routecard_create', 'approve'],
    open: 'approval_rc',
    verb: 'sent for approval',
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
    changesLacks: RC_TO_DRAFT_CHANGE,
  },
  {
    // Kept FIRST of the PO APPROVE rules (noteRuleFor answers this one).
    // Only a PO that sends material out (job work / service — the po_to_dc
    // list's poSendsMaterialOut rule), never a plain material PO.
    entity: 'PurchaseOrder',
    action: 'APPROVE',
    right: ['ospdc_create', 'entry'],
    open: 'po_to_dc',
    verb: 'approved',
    tail: ' — material can be sent',
    tone: 'due',
    changesHas: PO_DECISION,
    when: (cid) => sql`EXISTS (
      SELECT 1 FROM public.purchase_orders spo
      WHERE spo.id = a.entity_id AND spo.company_id = ${cid}::uuid
        AND spo.po_type::text = ANY(${sql.param([...SEND_OUT_TYPES])}::text[]))`,
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
    // Owner rule 4 — an NC raised (op-entry QC reject, Incoming QC, auto NC
    // at QC deviation, NC screen): whoever disposes NCs (nc-register
    // disposeNc demands nc_dispose ADVANCE, ADR-231). Open while still NC
    // Raised (status pending).
    entity: 'NonConformance',
    action: 'CREATE',
    right: ['nc_dispose', 'advance'],
    open: 'nc_dispose',
    verb: 'raised',
    tail: ' — waiting for disposition',
    tone: 'due',
  },
  {
    // Owner rule 4 — disposed Return to Vendor: whoever raises the return
    // challan (create-nc-dc demands ospdc_create entry). Open while the NC is
    // ready for its challan (lib/rtv-predicates — createNcDc's own guards).
    entity: 'NonConformance',
    action: 'DISPOSE',
    right: ['ospdc_create', 'entry'],
    open: 'nc_rtv_dc',
    verb: 'sent back to vendor',
    tail: ' — return challan to raise',
    tone: 'due',
    changesHas: NC_TO_RTV,
  },
  {
    // Owner rule 4 — a count submitted (stock-counts submitStockCount) waits
    // for the Approve tick (approveStockCount). Open while still submitted.
    entity: 'StockCount',
    action: 'SUBMIT',
    right: ['stockcount_create', 'approve'],
    open: 'stock_count_approve',
    verb: 'submitted',
    tail: ' — waiting for your approval',
    tone: 'due',
  },
  // ── Decisions → the raiser only (owner rules 2 + 3) ──
  {
    entity: 'PurchaseRequest',
    action: 'REJECT',
    right: ['pr_create', 'entry'],
    open: 'raiser_pr',
    verb: 'rejected',
    tail: ' — your request',
    doneTail: ' — your request',
    tone: 'late',
    changesHas: PR_DECISION,
    raiser: { table: 'public.purchase_requests', owner: 'created_by' },
    withReason: true,
  },
  {
    entity: 'PurchaseOrder',
    action: 'REJECT',
    right: ['po_create', 'entry'],
    open: 'raiser_po',
    verb: 'rejected',
    tail: ' — your PO',
    doneTail: ' — your PO',
    tone: 'late',
    changesHas: PO_DECISION,
    raiser: { table: 'public.purchase_orders', owner: 'created_by' },
    withReason: true,
  },
  {
    entity: 'PurchaseOrder',
    action: 'APPROVE',
    right: ['po_create', 'entry'],
    open: 'raiser_po_approved',
    verb: 'approved',
    tail: ' — your PO',
    doneTail: ' — your PO',
    tone: 'ok',
    changesHas: PO_DECISION,
    raiser: { table: 'public.purchase_orders', owner: 'created_by' },
  },
  {
    // ADR-253 — the creator hears the decision on their Route Card (a card
    // born from a Job Card / plan has a creator who may only view Route
    // Cards — the note is theirs whatever their rights).
    entity: 'RouteCard',
    action: 'REJECT',
    right: ['routecard_create', 'view'],
    open: 'raiser_rc',
    verb: 'rejected',
    tail: ' — your Route Card',
    doneTail: ' — your Route Card',
    tone: 'late',
    changesHas: RC_DECISION,
    raiser: { table: 'public.route_cards', owner: 'created_by' },
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
    changesHas: RC_DECISION,
    raiser: { table: 'public.route_cards', owner: 'created_by' },
  },
  {
    // Stock count approved = posted (approveStockCount). It has no reject:
    // a count is withdrawn through a Cancel Request (decision-notes.ts).
    entity: 'StockCount',
    action: 'POST',
    right: ['stockcount_create', 'entry'],
    open: 'raiser_stock_count',
    verb: 'approved',
    tail: ' — your stock count is posted',
    doneTail: ' — your stock count',
    tone: 'ok',
    raiser: { table: 'public.stock_counts', owner: 'created_by' },
  },
  {
    // Day Log edit approval (day-logs/approvals.ts → entry-write log()):
    // entity 'Day Log', entity_id = the day's daily_reports row, ref_id = its
    // date. The entry's owner is daily_reports.user_id.
    entity: 'Day Log',
    action: 'EDIT_APPROVED',
    right: ['daylog_view', 'view'],
    open: 'raiser_day_log',
    verb: 'approved the change on',
    tail: ' — your Day Log',
    doneTail: ' — your Day Log',
    tone: 'ok',
    raiser: { table: 'public.daily_reports', owner: 'user_id', needsRight: true },
    refLabel: (d) => `Day Log ${dmy(d)}`,
  },
  {
    entity: 'Day Log',
    action: 'EDIT_REJECTED',
    right: ['daylog_view', 'view'],
    open: 'raiser_day_log',
    verb: 'rejected the change on',
    tail: ' — your Day Log',
    doneTail: ' — your Day Log',
    tone: 'late',
    raiser: { table: 'public.daily_reports', owner: 'user_id', needsRight: true },
    refLabel: (d) => `Day Log ${dmy(d)}`,
  },
];

/** A rule's stable id (entity + action + next step are unique per rule). */
export const ruleId = (r: NoteRule): string => `${r.entity}:${r.action}:${r.open}`;

/** Owner rule 1 (2-Nov-2026, "Super Admin can see ALL notifications"). */
export const seesAll = (a: DashAccess): boolean => a.isAdmin || a.eff.fullAccess;

/** The rules this caller can receive. Owner rule 1: Super Admin / Full Access
 *  get every rule. Owner rule 2: a raiser rule is the raiser's whatever their
 *  rights (the activity read delivers it only to the raiser). */
export function rulesFor(a: DashAccess): NoteRule[] {
  if (seesAll(a)) return [...NOTE_RULES];
  return NOTE_RULES.filter(
    (r) => (r.raiser && !r.raiser.needsRight) || hasTick(a, r.right[0], r.right[1]),
  );
}

/** One rule's condition on the activity row `a`. Every rule but a raiser
 *  rule skips the caller's own events; a raiser rule (owner rules 2 + 3)
 *  keeps them and instead requires the document to be the caller's. For a
 *  caller who sees all (owner rule 1) a raiser rule takes every document,
 *  but still not the caller's own decision on someone else's document. */
export function ruleCond(r: NoteRule, cid: string, me: string, seeAll = false): SQL {
  const parts: SQL[] = [sql`a.entity = ${r.entity}`, sql`a.action = ${r.action}`];
  if (r.toPending) {
    parts.push(sql`COALESCE(a.changes @> ${RC_TO_PENDING_CHANGE}::jsonb, false)`);
  }
  if (r.changesHas) parts.push(sql`COALESCE(a.changes @> ${r.changesHas}::jsonb, false)`);
  if (r.changesLacks) parts.push(sql`NOT COALESCE(a.changes @> ${r.changesLacks}::jsonb, false)`);
  if (r.when) parts.push(r.when(cid));
  if (r.raiser) {
    const owner = sql`rd.${sql.raw(r.raiser.owner)} = ${me}::uuid`;
    parts.push(sql`EXISTS (
      SELECT 1 FROM ${sql.raw(r.raiser.table)} rd
      WHERE rd.id = a.entity_id AND rd.company_id = ${cid}::uuid AND rd.deleted_at IS NULL
        AND ${seeAll ? sql`(a.user_id <> ${me}::uuid OR ${owner})` : owner})`);
  } else {
    parts.push(sql`a.user_id <> ${me}::uuid`);
  }
  return sql`(${sql.join(parts, sql` AND `)})`;
}

/** Owner rule 1 — the raiser's name when the document is NOT the caller's
 *  (null when it is): one CASE over the raiser documents, per entity. Only a
 *  caller who sees all needs it. `alias` = the row holding entity +
 *  entity_id (the activity read runs it on its LIMITed rows only). */
export function raiserNameSql(me: string, alias = 'a'): SQL {
  const ent = sql.raw(`${alias}.entity`);
  const id = sql.raw(`${alias}.entity_id::uuid`);
  const byEntity = new Map<string, RaiserOf>();
  for (const r of NOTE_RULES)
    if (r.raiser && !byEntity.has(r.entity)) byEntity.set(r.entity, r.raiser);
  const whens = [...byEntity].map(([entity, ro]) => {
    const col = sql.raw(`rd.${ro.owner}`);
    return sql`WHEN ${entity}::text THEN (
      SELECT CASE WHEN ${col} <> ${me}::uuid
               THEN COALESCE(NULLIF(btrim(ru.full_name), ''), ru.email) END
      FROM ${sql.raw(ro.table)} rd LEFT JOIN public.users ru ON ru.id = ${col}
      WHERE rd.id = ${id})`;
  });
  return sql`(CASE ${ent} ${sql.join(whens, sql` `)} END)`;
}

/** A raiser rule's tail for someone else's document: "your PO" → "Rakesh's PO". */
export const othersTail = (tail: string, name: string): string =>
  tail.replace(' your ', ` ${name}'s `);

/** The page a note's number opens: entityHref, plus the two documents
 *  entityHref has no page for (Stock Count, Day Log). */
export function noteHref(entity: string, id: string, refId: string): string | null {
  if (entity === 'StockCount') return `/stock-counts/${id}`;
  if (entity === 'Day Log') return `/task-board?view=daylog&date=${encodeURIComponent(refId)}`;
  return entityHref(entity, id, refId);
}

/** "Still open?" for the next steps with no home list of their own: the
 *  ids (of `ids`) still in the state the note announces. */
export function openSql(
  open: Open,
  cid: string,
  me: string,
  ids: string[],
  seeAll = false,
): SQL | null {
  const idIn = sql`AND d.id = ANY(${sql.param(ids)}::uuid[])`;
  // Owner rule 1: a caller who sees all keeps someone else's document too.
  const mine = (col: string): SQL => (seeAll ? sql`` : sql`AND d.${sql.raw(col)} = ${me}::uuid`);
  switch (open) {
    case 'raiser_po_approved':
      return sql`SELECT d.id::text AS id FROM public.purchase_orders d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          ${mine('created_by')} ${idIn}`;
    case 'raiser_stock_count':
      return sql`SELECT d.id::text AS id FROM public.stock_counts d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          ${mine('created_by')} ${idIn}`;
    case 'raiser_day_log':
      return sql`SELECT d.id::text AS id FROM public.daily_reports d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          ${mine('user_id')} ${idIn}`;
    case 'nc_dispose':
      return sql`SELECT d.id::text AS id FROM public.nc_register d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          AND d.status = 'pending'::nc_status ${idIn}`;
    case 'nc_rtv_dc':
      return sql`SELECT d.id::text AS id FROM public.nc_register d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          AND ${rtvReadyForChallanSql('d')} ${idIn}`;
    case 'stock_count_approve':
      return sql`SELECT d.id::text AS id FROM public.stock_counts d
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          AND d.status = 'submitted' ${idIn}`;
    default:
      return null;
  }
}
