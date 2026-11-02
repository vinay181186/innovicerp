// Owner rules 2 + 3 (2-Nov-2026) — decision notes from the stores that keep a
// decision OUTSIDE the activity log's own APPROVE / REJECT rows (those are
// raiser rules in note-rules.ts):
//   edit    document_edit_requests  approved / rejected (partly = approved
//           with some changes rejected) → the requester AND the document's
//           creator ("asker + creator")
//   cancel  cancel_requests         approved / rejected → requester + creator
//   time    op_log_time_change_requests approved / rejected → requester + the
//           op entry's creator
// One note per caller per decision (requester = creator → one note). The
// decider's own decision still notes them when it is their paperwork (rule 3).
// Delivered whatever the caller's rights — it is their own paperwork.
// Each read: company_id, deleted_at IS NULL, decided inside the window, LIMIT.

import {
  CANCEL_DOC_LABELS,
  type CancelDocType,
  type DashNote,
  docNavPage,
  type DocumentEditEntity,
  ONE_STEP_CANCEL_DOC_TYPES,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { codePart, entityHref, str } from './util';

/** A note worded at read time (not an activity rule). `open` = its next step
 *  is still open (home shows only open ones; a decision is always open). */
export type ExtraNote = DashNote & { actorName: string | null; open: boolean };

/** One note source inside its own savepoint (drizzle nested transaction):
 *  a failing statement (a missing grant, a renamed table) rolls back to the
 *  savepoint and is logged, and only THAT source is left out — the home's
 *  other notes and the bell still answer. Sources run one after another
 *  (savepoints on one connection must not interleave). The logger is loaded
 *  only on failure, so the unit tests need no environment. */
export async function guardedRead<T>(
  tx: DbTransaction,
  source: string,
  read: (sp: DbTransaction) => Promise<T[]>,
): Promise<T[]> {
  try {
    return await tx.transaction((sp) => read(sp as DbTransaction));
  } catch (err) {
    const { logger } = await import('../../../lib/logger');
    logger.error({ err, source }, 'dashboard note source failed');
    return [];
  }
}

/** Most decision rows read per store. */
const DECISION_SCAN = 200;

/** The table holding each edit-approval document (its created_by is the
 *  creator). A full Record: a new entity without a table fails the typecheck. */
const EDIT_DOC_TABLE: Readonly<Record<DocumentEditEntity, string>> = {
  PurchaseOrder: 'public.purchase_orders',
  PurchaseRequest: 'public.purchase_requests',
  NonConformance: 'public.nc_register',
  Plan: 'public.plans',
  SalesOrder: 'public.sales_orders',
  JobWorkOrder: 'public.job_work_orders',
  GoodsReceiptNote: 'public.goods_receipt_notes',
  JobCard: 'public.job_cards',
  Dispatch: 'public.customer_dispatches',
  DeliveryChallan: 'public.delivery_challans',
  PartyGrn: 'public.party_grn',
  ProductionOrder: 'public.production_orders',
  Item: 'public.items',
  Vendor: 'public.vendors',
  Client: 'public.clients',
  Machine: 'public.machines',
  MachineGroup: 'public.machine_groups',
  Operator: 'public.operators',
  CostCenter: 'public.cost_centers',
  TpiInspector: 'public.tpi_masters',
  QcProcess: 'public.qc_processes',
  MaterialGrade: 'public.material_grades',
  MaterialSize: 'public.material_sizes',
  Instrument: 'public.instruments',
  BOM: 'public.bom_masters',
  RouteCard: 'public.route_cards',
  MlBom: 'public.ml_boms',
};

/** The table each cancel type's doc_id names (the handler's lock reads it),
 *  and the edit entity its page link follows (cancel-requests registry
 *  editEntity — the same link the Approvals page gives; null = no page). */
const CANCEL_DOC: Readonly<
  Record<CancelDocType, { table: string; entity: DocumentEditEntity | null }>
> = {
  invoice: { table: 'public.invoices', entity: null },
  jw_invoice: { table: 'public.jw_invoices', entity: null },
  customer_dispatch: { table: 'public.customer_dispatches', entity: 'Dispatch' },
  jw_return: { table: 'public.jw_return_challans', entity: null },
  customer_material_return: { table: 'public.customer_material_returns', entity: null },
  party_grn: { table: 'public.party_grn', entity: 'PartyGrn' },
  party_material_issue: { table: 'public.party_material_issues', entity: null },
  delivery_challan: { table: 'public.delivery_challans', entity: 'DeliveryChallan' },
  store_issue: { table: 'public.store_issues', entity: null },
  stock_count: { table: 'public.stock_counts', entity: null },
  tool_issue: { table: 'public.tool_issues', entity: null },
  purchase_request: { table: 'public.purchase_requests', entity: 'PurchaseRequest' },
  purchase_order: { table: 'public.purchase_orders', entity: 'PurchaseOrder' },
  jw_dc_outward: { table: 'public.jw_dc_outward', entity: null },
  plan: { table: 'public.plans', entity: 'Plan' },
  job_work_order: { table: 'public.job_work_orders', entity: 'JobWorkOrder' },
  sales_order: { table: 'public.sales_orders', entity: 'SalesOrder' },
  grn: { table: 'public.goods_receipt_notes', entity: 'GoodsReceiptNote' },
  job_card: { table: 'public.job_cards', entity: 'JobCard' },
  production_order: { table: 'public.production_orders', entity: 'ProductionOrder' },
  dc_receipt: { table: 'public.delivery_challan_receipts', entity: null },
  jw_dc_inward: { table: 'public.jw_dc_inward', entity: null },
};

/** CASE <key> WHEN '<k>' THEN (SELECT created_by FROM <table> WHERE id = <id>) … END */
function creatorCase(key: SQL, id: SQL, tables: ReadonlyArray<readonly [string, string]>): SQL {
  const whens = tables.map(
    ([k, t]) =>
      sql`WHEN ${k}::text THEN (SELECT x.created_by FROM ${sql.raw(t)} x WHERE x.id = ${id})`,
  );
  return sql`(CASE ${key} ${sql.join(whens, sql` `)} END)`;
}

/** One decided request, as the three stores are read. */
export interface DecisionRow {
  kind: 'edit' | 'cancel' | 'time';
  id: string;
  status: 'approved' | 'rejected';
  docCode: string;
  docHref: string | null;
  /** Edit: changes approved / in the request (partly approved when less). */
  approvedN: number;
  totalN: number;
  /** Cancel: the document type's screen name. */
  docLabel: string | null;
  requestedBy: string;
  creator: string | null;
  /** Owner rule 1 — names for a caller who sees all (full name, else e-mail). */
  askerName: string | null;
  creatorName: string | null;
  decidedBy: string | null;
  decider: string;
  decidedAt: string;
  reason: string | null;
  /** One-step cancel (the Edit tick cancels at once, owner rule 2026-10-31). */
  oneStep: boolean;
}

/** The caller's note for one decision, or null when it is not theirs. A
 *  caller who sees all (owner rule 1) gets one note per decision, worded with
 *  the asker's name ("— Parth's edit") when it is not theirs — but never for
 *  their own decision on someone else's paperwork. Pure. */
export function decisionNote(r: DecisionRow, me: string, seeAll = false): ExtraNote | null {
  const asker = r.requestedBy === me;
  const creator = r.creator === me;
  const others = !asker && !creator;
  if (others && (!seeAll || r.decidedBy === me)) return null;
  // A one-step cancel is the canceller's own act, not someone's decision:
  // never a note to the person who cancelled (also when it is their own
  // document), nor to an admin when the creator cancelled their own.
  if (r.oneStep && (asker || r.decidedBy === me)) return null;
  if (r.oneStep && others && r.creator === r.requestedBy) return null;
  const whose = (fallback: string | null): string => `${fallback ?? 'someone'}'s`;
  const ok = r.status === 'approved';
  const verb = ok ? 'approved' : 'rejected';
  let lead: string;
  let thing: string;
  if (r.kind === 'edit') {
    const partly = ok && r.approvedN > 0 && r.approvedN < r.totalN;
    lead = partly
      ? `${r.decider} approved ${r.approvedN} of ${r.totalN} changes to `
      : `${r.decider} ${verb} the edit of `;
    thing = asker ? 'your edit' : creator ? 'your document' : `${whose(r.askerName)} edit`;
  } else if (r.kind === 'cancel') {
    lead = r.oneStep ? `${r.decider} cancelled ` : `${r.decider} ${verb} cancelling `;
    const label = r.docLabel ?? 'document';
    if (others) {
      thing = r.oneStep
        ? `${whose(r.creatorName)} ${label}`
        : `${whose(r.askerName)} cancel request`;
    } else {
      thing = asker && !r.oneStep ? 'your cancel request' : `your ${label}`;
    }
  } else {
    lead = `${r.decider} ${verb} the time change on `;
    thing = asker ? 'your request' : creator ? 'your entry' : `${whose(r.askerName)} request`;
  }
  return {
    key: `dec:${r.kind}:${r.id}:${r.status}`,
    ts: r.decidedAt,
    tone: ok ? 'ok' : 'late',
    actorName: r.decider,
    open: true,
    unseen: false,
    text: [
      { text: lead },
      codePart(r.docCode, r.docHref),
      { text: ` — ${thing}` },
      ...(!ok && r.reason ? [{ text: ` · ${r.reason}` }] : []),
    ],
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const nameOf = (alias: string): SQL =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), ${alias}.email, 'Someone')`);

function toRow(kind: DecisionRow['kind'], r: Record<string, unknown>): DecisionRow {
  const docId = str(r['doc_id']);
  const code = String(r['doc_code'] ?? '');
  let docHref: string | null = null;
  let docLabel: string | null = null;
  let oneStep = false;
  if (kind === 'edit' && docId) docHref = entityHref(String(r['entity'] ?? ''), docId, code);
  if (kind === 'cancel') {
    const t = String(r['doc_type']) as CancelDocType;
    const ent = CANCEL_DOC[t]?.entity ?? null;
    docHref = ent && docId ? entityHref(ent, docId, code) : null;
    docLabel = CANCEL_DOC_LABELS[t] ?? null;
    oneStep = ONE_STEP_CANCEL_DOC_TYPES.includes(t) && r['decided_by'] === r['requested_by'];
  }
  if (kind === 'time' && docId) docHref = docNavPage('job-card', docId);
  return {
    kind,
    id: String(r['id']),
    status: r['status'] === 'approved' ? 'approved' : 'rejected',
    docCode: code,
    docHref,
    approvedN: Number(r['approved_n'] ?? 0),
    totalN: Number(r['total_n'] ?? 0),
    docLabel,
    requestedBy: String(r['requested_by']),
    creator: str(r['creator']),
    askerName: str(r['asker_name']),
    creatorName: str(r['creator_name']),
    decidedBy: str(r['decided_by']),
    decider: String(r['decider'] ?? 'Someone'),
    decidedAt: iso(r['decided_at']),
    reason: str(r['reason']),
    oneStep,
  };
}

/** The three bounded reads (company, window, mine, LIMIT) — run together on
 *  the transaction's connection. `since` = the window's first instant. */
export async function readDecisionNotes(
  tx: DbTransaction,
  cid: string,
  me: string,
  since: SQL,
  seeAll = false,
): Promise<ExtraNote[]> {
  // Owner rule 1: a caller who sees all reads every decision (still company,
  // window, LIMIT); everyone else only their own (asker or creator).
  const mineQ = seeAll ? sql`` : sql`WHERE q.requested_by = ${me} OR q.creator = ${me}`;
  const names = sql`, ${nameOf('au')} AS asker_name,
    CASE WHEN cu.id IS NULL THEN NULL ELSE ${nameOf('cu')} END AS creator_name`;
  const nameJoins = sql`LEFT JOIN public.users au ON au.id = q.requested_by::uuid
    LEFT JOIN public.users cu ON cu.id = q.creator::uuid`;
  const editCreator = creatorCase(sql`d.entity`, sql`d.entity_id`, Object.entries(EDIT_DOC_TABLE));
  const cancelCreator = creatorCase(
    sql`cr.doc_type`,
    sql`cr.doc_id`,
    Object.entries(CANCEL_DOC).map(([k, v]) => [k, v.table] as const),
  );
  const reads: Array<[DecisionRow['kind'], SQL]> = [
    [
      'edit',
      sql`SELECT q.* ${names} FROM (
        SELECT d.id::text AS id, d.status::text AS status, d.doc_code, d.entity,
          d.entity_id::text AS doc_id, d.requested_by::text AS requested_by,
          d.decided_by::text AS decided_by, ${nameOf('du')} AS decider,
          COALESCE(d.decided_at, d.updated_at) AS decided_at,
          COALESCE(d.decision_reason, (
            SELECT string_agg(x->>'reason', '; ') FROM jsonb_array_elements(d.decisions) x
            WHERE NULLIF(btrim(x->>'reason'), '') IS NOT NULL)) AS reason,
          (SELECT count(*) FROM jsonb_array_elements(d.decisions) x
            WHERE x->>'outcome' = 'approved')::int AS approved_n,
          jsonb_array_length(d.changes)::int AS total_n,
          ${editCreator}::text AS creator
        FROM public.document_edit_requests d
        LEFT JOIN public.users du ON du.id = d.decided_by
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          AND d.status IN ('approved', 'rejected')
          AND COALESCE(d.decided_at, d.updated_at) >= ${since}
      ) q ${nameJoins} ${mineQ}
      ORDER BY q.decided_at DESC LIMIT ${DECISION_SCAN}`,
    ],
    [
      'cancel',
      sql`SELECT q.* ${names} FROM (
        SELECT cr.id::text AS id, cr.status, cr.doc_code, cr.doc_type,
          cr.doc_id::text AS doc_id, cr.requested_by::text AS requested_by,
          cr.decided_by::text AS decided_by, ${nameOf('du')} AS decider,
          COALESCE(cr.decided_at, cr.updated_at) AS decided_at, cr.decision_note AS reason,
          ${cancelCreator}::text AS creator
        FROM public.cancel_requests cr
        LEFT JOIN public.users du ON du.id = cr.decided_by
        WHERE cr.company_id = ${cid}::uuid AND cr.deleted_at IS NULL
          AND cr.status IN ('approved', 'rejected')
          AND COALESCE(cr.decided_at, cr.updated_at) >= ${since}
      ) q ${nameJoins} ${mineQ}
      ORDER BY q.decided_at DESC LIMIT ${DECISION_SCAN}`,
    ],
    [
      'time',
      // Op # = op_seq × 10, the number opSrNo prints (approvals/history.ts).
      sql`SELECT r.id::text AS id, r.status::text AS status,
          jc.code || ' · Op #' || (o.op_seq * 10)::text AS doc_code, jc.id::text AS doc_id,
          r.requested_by::text AS requested_by, r.decided_by::text AS decided_by,
          ${nameOf('du')} AS decider, COALESCE(r.decided_at, r.updated_at) AS decided_at,
          r.decision_reason AS reason, l.created_by::text AS creator,
          ${nameOf('au')} AS asker_name,
          CASE WHEN cu.id IS NULL THEN NULL ELSE ${nameOf('cu')} END AS creator_name
        FROM public.op_log_time_change_requests r
        JOIN public.op_log l ON l.id = r.op_log_id
        LEFT JOIN public.users au ON au.id = r.requested_by
        LEFT JOIN public.users cu ON cu.id = l.created_by
        JOIN public.jc_ops o ON o.id = r.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id
        LEFT JOIN public.users du ON du.id = r.decided_by
        WHERE r.company_id = ${cid}::uuid AND r.deleted_at IS NULL
          AND r.status IN ('approved', 'rejected')
          AND COALESCE(r.decided_at, r.updated_at) >= ${since}
          ${seeAll ? sql`` : sql`AND (r.requested_by = ${me}::uuid OR l.created_by = ${me}::uuid)`}
        ORDER BY COALESCE(r.decided_at, r.updated_at) DESC LIMIT ${DECISION_SCAN}`,
    ],
  ];
  const results: DecisionRow[] = [];
  for (const [kind, q] of reads) {
    const rows = await guardedRead(tx, `decision:${kind}`, async (sp) =>
      ((await sp.execute(q)) as unknown as Array<Record<string, unknown>>).map((r) =>
        toRow(kind, r),
      ),
    );
    results.push(...rows);
  }
  return results.map((r) => decisionNote(r, me, seeAll)).filter((n): n is ExtraNote => n !== null);
}
