// Production Orders service (ADR-170, migration 0133; ADR-182, migration 0143).
//
// A Production Order (IN-PRO-#####) is the document that turns a
// route-card-driven plan into a Job Card:
//
// ADR-182 changed three things here:
//   - a plan may be covered by SEVERAL orders. Create takes its own Order Qty
//     and caps SUM(order_qty) of the plan's live, non-short-closed orders at
//     plans.plan_qty, inside the plan's row lock (lib/production-order-cap.ts).
//   - Create refuses unless the shop floor ticks "Raw material available", and
//     records the size actually cut; both snapshot on the order and the size is
//     carried onto the Job Card.
//   - Short Close stops an order at ANY stage. It is NOT the "close short"
//     below (which finishes a COMPLETE card and writes off its losses): it
//     freezes the order and its Job Card for good and gives the un-delivered
//     qty back to the plan. lib/production-order-stop.ts is the guard every
//     other module calls.
//
// ADR-184: a stopped order ('closed' or 'short_closed') covers only what it
// credited (lib/plan-order-coverage.ts), so both a finish-close with losses
// and a short close give back exactly the pieces not delivered, re-open the
// plan when that leaves Pending > 0 (shiftPlanPending), and log the true
// figures. Short close also records the real loss and closes the Job Card
// tree.
//
//   Plan (qty / dates / raw material)  +  Route Card (the item's operations)
//   +  Target Date   ──create──▶   Job Card   … the existing JC flow …
//   ──close (only once the JC is complete)──▶  stock credited ONCE with the
//   Job Card's actually finished qty (48 of a 50 plan credits 48).
//
// Close guard and losses (TEST run 2026-09-17, flow-po.spec.ts S1-d,
// IN-PRO-00001 / IN-JC-26-00055; generalised after the code review of
// e69d15e8): v_jc_op_status marks an op `complete` only when its output
// reaches the FULL order qty and never subtracts pieces that were lost, so
// 50 ordered → 2 scrapped at DIR → 48 finished left the JC 'open' for good
// and Close disabled. The guard therefore also accepts a JC that is "settled
// with losses" (jcSettledWithLossesSql below): every op has nothing left to
// do, no NC or rework / repair child is open, and finished + loss >= order
// qty. "Loss" is every piece that left the JC's route and never came back —
// scrapped, failed in a rework / repair child, or replaced by a make-fresh
// supplementary — not just a direct scrap. Losses are subtracted for the
// close guard ONLY: the views are unchanged and the credited qty is still the
// last op's finished qty (48), never the plan. A JC that lost EVERY piece
// (finished 0) closes with credited_qty 0 and no stock row. The rule is
// evaluated on the detail read and the Close path only, never per list row.
//
// What is deliberately NOT here:
//   - progress. `jcComputedStatus` / `jcFinishedQty` are read off v_jc_status /
//     v_jc_op_status on every read, never stored (they would drift the moment a
//     QC log is corrected).
//   - route-card write-back. Execute (plans/service.ts) saves a plan's typed
//     ops back onto the route card; here the route card IS the source, so
//     there is nothing to write back.
//   - the stock OFF switch. op-entry/qc-stock-cascade.ts and
//     goods-receipt-notes/cascades.ts read job_cards.production_order_id and
//     credit nothing for a PO-linked JC; the only credit is the close below.

import { and, asc, count, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  jobCards,
  plans,
  productionOrderCloses,
  productionOrders,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { withUniqueRetry } from '../../lib/db-retry';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { assertNoQcDirectlyAfterOutsource } from '../../lib/jc-osp-qc-rule';
import {
  createReservation,
  readLineItemId,
  itemCodeFor,
  readStockPosition,
  readUnreservedRequirement,
  releaseReservationForClose,
} from '../../lib/stock-reservation';
import { closeBlockedReason } from '../../lib/production-order-close-guard';
import { planCoverage, productionOrderCapError } from '../../lib/production-order-cap';
import { readPlanOrderCoverage } from '../../lib/plan-order-coverage';
import { assertProductionOrderNotShortClosed } from '../../lib/production-order-stop';
import { PRODUCTION_ORDER_LINK_MAX_DEPTH } from '../../lib/production-order-link';
import { emitActivityLog } from '../activity-log/service';
import { buildJobCardFromOps, type JcBuildOp } from '../plans/service';
import type {
  CloseProductionOrderInput,
  CreateProductionOrderInput,
  ListProductionOrdersQuery,
  ListProductionOrdersResponse,
  NextProductionOrderCodeResponse,
  ProductionOrderClose,
  ProductionOrderDetail,
  ProductionOrderListItem,
  ReverseProductionOrderCloseInput,
  ShortCloseProductionOrderInput,
} from './schema';

const PO_PREFIX = 'IN-PRO-';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function dateOnly(v: Date | string): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Escape ILIKE metacharacters so a typed "_" or "%" searches literally
 *  (backslash is Postgres's default LIKE escape — same as tpi-masters). */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Next IN-PRO-##### for the company. Same shape as jw-returns nextReturnCode:
 *  only codes with the exact prefix + digits count toward the max, so the
 *  series stays clean whatever else lands in the column. */
async function nextProductionOrderCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: productionOrders.code })
    .from(productionOrders)
    .where(
      and(eq(productionOrders.companyId, companyId), like(productionOrders.code, `${PO_PREFIX}%`)),
    );
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(PO_PREFIX.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${PO_PREFIX}${String(max + 1).padStart(5, '0')}`;
}

// ─── Live Job Card progress ────────────────────────────────────────────────
// Read from the views, never stored. Both expressions are keyed off the PO's
// own job_card_id so they work as plain select columns on the list query.

/** v_jc_status.computed_status of the linked JC. COALESCE 'no_ops' covers a JC
 *  the view has no row for (it has no ops) — the shared enum has that value. */
const JC_COMPUTED_STATUS_SQL = sql<string>`COALESCE((
  SELECT s.computed_status FROM public.v_jc_status s
  WHERE s.job_card_id = ${productionOrders.jobCardId}
), 'no_ops')`;

/** Output of a JC's LAST live op — the SAME expression job-cards/service.ts
 *  uses for `lastOpCompletedQty`: qc_accepted_qty for a QC / qc_required op,
 *  completed_qty otherwise. `jcId` is any SQL expression yielding the JC's id.
 *  This is the number Close credits. */
function lastOpFinishedQtySql(jcId: SQL): SQL<number> {
  return sql<number>`COALESCE((
  SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
              THEN vos.qc_accepted_qty ELSE vos.completed_qty END
  FROM public.v_jc_op_status vos
  WHERE vos.job_card_id = ${jcId}
  ORDER BY vos.op_seq DESC LIMIT 1
), 0)::int`;
}

const JC_FINISHED_QTY_SQL = lastOpFinishedQtySql(sql`${productionOrders.jobCardId}`);

/** LOSS = pieces that left the route and never came back, summed over the
 *  NCs matched by `ncFilter` (a whole JC, or one op of it). Read straight off
 *  nc_register because v_nc_op_breakup exposes scrap_qty only and lumps
 *  make_fresh into nc_closed_qty together with use_as_is (0131):
 *   - closed scrap       → rejected_qty (what v_nc_op_breakup.scrap_qty counts);
 *   - closed make_fresh  → rejected_qty — the NC closes at once and the
 *                          supplementary JC is its own document (own stock
 *                          path, parent_nc_id only, no parent_job_card_id),
 *                          so those pieces are gone from THIS route;
 *   - rework / repair    → failed_qty — written by climbRecoveryToAncestors
 *                          when the piece is scrapped on the child JC (the
 *                          child counts the same piece once as ITS scrap);
 *   - return_to_vendor   → nothing. A replacement piece that fails Incoming
 *                          QC is raised again as a follow-on NC on the SAME
 *                          op (cascades.ts createAutoNc, parent_nc_id), and
 *                          that NC is counted when it is scrapped; adding
 *                          the RTV row's failed_qty too would count the piece
 *                          twice.
 *  Same filter as v_nc_op_breakup (deleted_at IS NULL, jc_op_id IS NOT NULL),
 *  so both legs see the same NCs. KNOWN BLIND SPOT (pre-existing, not fixed
 *  here): a manual NC raised with jc_op_id NULL is in neither v_nc_op_breakup
 *  nor this sum, so it can neither hold the JC open nor count as a loss —
 *  the ordinary 'complete' path has never seen it either. */
function lossSql(ncFilter: SQL): SQL<number> {
  return sql<number>`COALESCE((
      SELECT SUM(CASE
        WHEN nc.status = 'closed' AND nc.disposition IN ('scrap', 'make_fresh') THEN nc.rejected_qty
        WHEN nc.disposition IN ('rework', 'repair') THEN nc.failed_qty
        ELSE 0 END)
      FROM public.nc_register nc
      WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL AND ${ncFilter}
    ), 0)`;
}

/** How many levels of rework / repair children the settled rule itself is
 *  applied to. 0 = the JC in hand; 1 = its children; 2 = grandchildren
 *  (rework-of-a-rework exists on TEST: IN-JC-26-00037 → -RW1 → -RW1-RW1).
 *  A child deeper than this must read plain complete / closed. Each level
 *  embeds the whole rule once more; it runs on the detail read only. */
const SETTLED_RULE_DEPTH = 2;

/** "Settled with losses" — true when the JC cannot reach v_jc_status
 *  'complete' only because pieces were LOST along the route, yet nothing is
 *  left to do. `jcId` is any SQL expression yielding the JC's id; `depth` is
 *  the recursion level (see SETTLED_RULE_DEPTH). All four legs must hold:
 *   1. no op still has work — v_jc_op_status: computed_status <> 'running';
 *      available = 0 on every in-house non-QC op; on an outsource op
 *      available net of this op's own loss = 0 (available there still counts
 *      the vendor-rejected pieces: input − accepted − open RTV, so a piece
 *      scrapped / made fresh / failed there would hold the op open forever);
 *      qc_pending = 0 on every QC / qc_required op; nothing at the vendor,
 *      in Incoming QC or owed to rework;
 *   2. no open NC on any op — v_nc_op_breakup: Σ nc_open_qty = Σ open_nc_count = 0;
 *   3. every rework / repair child JC (parent_job_card_id = this JC) is done:
 *      its v_jc_status is 'complete' / 'closed', OR — while depth <
 *      SETTLED_RULE_DEPTH — it is itself settled with losses by this very
 *      rule (a child that accepted 1 of 2 and scrapped 1 stays 'open' for
 *      exactly the same reason its parent does);
 *   4. the pieces are accounted for — last-op finished qty (lastOpFinishedQtySql)
 *      + loss (lossSql) >= order_qty, AND loss > 0 so the ordinary 'complete'
 *      path is untouched when nothing was lost.
 *  Guarantee: legs 1–3 say nothing is in flight anywhere, leg 4 says every
 *  piece is either finished or lost, so the rule can never be true while work
 *  is genuinely outstanding — inconsistent data can only make it false, which
 *  blocks Close, never opens it.
 *  Views + nc_register only, nothing stored. Aliases carry the depth
 *  (jc0 / child0, jc1 / child1 …) so the nested copies cannot shadow each
 *  other. Walk-throughs on TEST (read-only SELECTs, 2026-09-17):
 *    IN-JC-26-00055 (IN-PRO-00001): 50 ordered, DIR scrapped 2, 48 finished
 *      → loss 2, 48 + 2 >= 50 → true.
 *    IN-JC-26-00037-RW1: rework child of 6, its own NC rework 4 → cleared 2 /
 *      failed 2 (grandchild scrapped 2), 4 finished → loss 2, 4 + 2 >= 6 → true;
 *      its parent IN-JC-26-00037 (20 ordered, 4 still at the vendor) → false.
 *    IN-JC-26-00056 / 00057 (IN-PRO-00002 / 3, nothing lost) → false.
 *  Exported only so the rendered SQL can be checked outside the module (no
 *  route calls it directly). */
export function jcSettledWithLossesSql(jcId: SQL, depth = 0): SQL<boolean> {
  const jc = sql.raw(`jc${depth}`);
  const child = sql.raw(`child${depth}`);
  const childSettled =
    depth < SETTLED_RULE_DEPTH
      ? sql` AND NOT (${jcSettledWithLossesSql(sql`${child}.id`, depth + 1)})`
      : sql``;
  return sql<boolean>`COALESCE((
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.v_jc_op_status vos
      WHERE vos.job_card_id = ${jc}.id
        AND (
          vos.computed_status = 'running'
          -- any non-QC op: pieces still available minus pieces lost ON that
          -- very op (a scrap NC raised on a process op leaves completed < input
          -- for good; on an outsource op the view keeps vendor-rejected pieces
          -- in available). Pieces lost on a LATER op are not netted here —
          -- they were already output by this op.
          OR (vos.op_type <> 'qc'
              AND vos.available - ${lossSql(sql`nc.jc_op_id = vos.jc_op_id`)} > 0)
          OR ((vos.op_type = 'qc' OR vos.qc_required) AND vos.qc_pending <> 0)
          OR vos.at_vendor_qty <> 0
          OR vos.in_qc_qty <> 0
          OR vos.rework_pending_qty <> 0
        )
    )
    AND COALESCE((
      SELECT SUM(b.nc_open_qty) + SUM(b.open_nc_count)
      FROM public.v_nc_op_breakup b
      WHERE b.job_card_id = ${jc}.id
    ), 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.job_cards ${child}
      JOIN public.v_jc_status cs ON cs.job_card_id = ${child}.id
      WHERE ${child}.parent_job_card_id = ${jc}.id
        AND ${child}.deleted_at IS NULL
        AND cs.computed_status NOT IN ('complete', 'closed')${childSettled}
    )
    AND ${lossSql(sql`nc.job_card_id = ${jc}.id`)} > 0
    AND ${lastOpFinishedQtySql(sql`${jc}.id`)}
      + ${lossSql(sql`nc.job_card_id = ${jc}.id`)} >= ${jc}.order_qty
  FROM public.job_cards ${jc}
  WHERE ${jc}.id = ${jcId}
    AND ${jc}.deleted_at IS NULL
), false)`;
}

/** Customer (SO) or client (JWSO) name, read live through the plan's line. A
 *  plan carries at most one of so_line_id / jw_line_id, so at most one branch
 *  of the COALESCE yields a row. */
const PARTY_NAME_SQL = sql<string | null>`COALESCE(
  (SELECT c.name FROM public.plans p
     JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
     JOIN public.sales_orders so ON so.id = sol.sales_order_id
     JOIN public.clients c ON c.id = so.client_id
   WHERE p.id = ${productionOrders.planId} LIMIT 1),
  (SELECT c.name FROM public.plans p
     JOIN public.job_work_order_lines jl ON jl.id = p.jw_line_id
     JOIN public.job_work_orders jw ON jw.id = jl.job_work_order_id
     JOIN public.clients c ON c.id = jw.client_id
   WHERE p.id = ${productionOrders.planId} LIMIT 1)
)`;

/** ADR-177: the drawing revision of the SO line (or, for a JWSO plan, the JW
 *  line) this Production Order was raised for — read LIVE through the plan,
 *  never snapshotted, so a reissued drawing shows on every open PO. Same
 *  one-branch-only shape as PARTY_NAME_SQL. ::text for the pre-0119 reason
 *  every other itemRevision read gives. Null when the plan has no line. */
const ITEM_REVISION_SQL = sql<string | null>`COALESCE(
  (SELECT sol.revision::text FROM public.plans p
     JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
   WHERE p.id = ${productionOrders.planId} LIMIT 1),
  (SELECT jl.revision::text FROM public.plans p
     JOIN public.job_work_order_lines jl ON jl.id = p.jw_line_id
   WHERE p.id = ${productionOrders.planId} LIMIT 1)
)`;

/** POL — the line number printed on the CUSTOMER's own purchase order, read
 *  live off the SO line this order's plan was raised from. Unlike the revision
 *  above there is no job-work branch: a JWSO line has no customer PO, so a
 *  JWSO-sourced order is correctly null. Reads the plan row already LEFT
 *  JOINed by baseQuery, so this costs one primary-key lookup and no new join. */
const CLIENT_PO_LINE_NO_SQL = sql<string | null>`(
  SELECT sol.client_po_line_no
    FROM public.sales_order_lines sol
   WHERE sol.id = ${plans.soLineId} LIMIT 1
)`;

const createdByUser = alias(users, 'po_created_by');
const closedByUser = alias(users, 'po_closed_by');
const shortClosedByUser = alias(users, 'po_short_closed_by');

// Named column list rather than a bare select(): house rule 6 forbids SELECT *,
// and spelling the columns out means a column added later cannot silently
// start travelling to the browser.
const poColumns = {
  id: productionOrders.id,
  companyId: productionOrders.companyId,
  code: productionOrders.code,
  status: productionOrders.status,
  planId: productionOrders.planId,
  planCodeText: productionOrders.planCodeText,
  soCodeText: productionOrders.soCodeText,
  lineNo: productionOrders.lineNo,
  itemId: productionOrders.itemId,
  itemCodeText: productionOrders.itemCodeText,
  itemNameText: productionOrders.itemNameText,
  routeCardId: productionOrders.routeCardId,
  routeCardCodeText: productionOrders.routeCardCodeText,
  routeCardRevision: productionOrders.routeCardRevision,
  jobCardId: productionOrders.jobCardId,
  jcCodeText: productionOrders.jcCodeText,
  orderQty: productionOrders.orderQty,
  targetDate: productionOrders.targetDate,
  // ADR-182 — raw-material confirmation, the size really cut, and the short
  // close stamps.
  rawMaterialAvailable: productionOrders.rawMaterialAvailable,
  actualSize: productionOrders.actualSize,
  shortClosedAt: productionOrders.shortClosedAt,
  shortClosedBy: productionOrders.shortClosedBy,
  shortCloseReason: productionOrders.shortCloseReason,
  closedAt: productionOrders.closedAt,
  closedBy: productionOrders.closedBy,
  creditedQty: productionOrders.creditedQty,
  lostQty: productionOrders.lostQty,
  remarks: productionOrders.remarks,
  createdAt: productionOrders.createdAt,
  createdBy: productionOrders.createdBy,
  updatedAt: productionOrders.updatedAt,
  updatedBy: productionOrders.updatedBy,
  deletedAt: productionOrders.deletedAt,
  // live joins
  jcComputedStatus: JC_COMPUTED_STATUS_SQL,
  jcFinishedQty: JC_FINISHED_QTY_SQL,
  // The settled-with-losses flag is deliberately NOT a column here: it is
  // close-guard input only, needed by the detail / Close path, and running it
  // for every list row would be wasted work (readJcSettledWithLosses below).
  jcClosedAt: jobCards.closedAt,
  jcExists: jobCards.id,
  partyName: PARTY_NAME_SQL,
  // Raw material lives on the plan (the order's input); read live, not copied.
  rawMaterialGradeText: plans.rawMaterialGradeText,
  rawMaterialSizeText: plans.rawMaterialSizeText,
  itemRevision: ITEM_REVISION_SQL,
  clientPoLineNo: CLIENT_PO_LINE_NO_SQL,
  createdByName: createdByUser.fullName,
  closedByName: closedByUser.fullName,
  shortClosedByName: shortClosedByUser.fullName,
};

/** One row of `baseQuery` (declared below; function declarations hoist). */
type PoRow = Awaited<ReturnType<typeof baseQuery>>[number];

function toListItem(r: PoRow): ProductionOrderListItem {
  return {
    id: r.id,
    companyId: r.companyId,
    code: r.code,
    status: r.status as ProductionOrderListItem['status'],
    planId: r.planId,
    planCodeText: r.planCodeText,
    soCodeText: r.soCodeText,
    lineNo: r.lineNo,
    itemId: r.itemId,
    itemCodeText: r.itemCodeText,
    itemNameText: r.itemNameText,
    itemRevision: r.itemRevision ?? null,
    clientPoLineNo: r.clientPoLineNo ?? null,
    routeCardId: r.routeCardId,
    routeCardCodeText: r.routeCardCodeText,
    routeCardRevision: r.routeCardRevision,
    jobCardId: r.jobCardId,
    jcCodeText: r.jcCodeText,
    orderQty: r.orderQty,
    targetDate: dateOnly(r.targetDate),
    rawMaterialAvailable: r.rawMaterialAvailable ?? true,
    actualSize: r.actualSize ?? null,
    shortClosedAt: toIso(r.shortClosedAt),
    shortClosedBy: r.shortClosedBy ?? null,
    shortCloseReason: r.shortCloseReason ?? null,
    closedAt: toIso(r.closedAt),
    closedBy: r.closedBy,
    creditedQty: r.creditedQty,
    lostQty: r.lostQty ?? null,
    remarks: r.remarks,
    createdAt: toIso(r.createdAt) ?? '',
    createdBy: r.createdBy,
    updatedAt: toIso(r.updatedAt) ?? '',
    updatedBy: r.updatedBy,
    deletedAt: toIso(r.deletedAt),
    // The JC row itself is gone only on a hard delete; the contract says null
    // in that one case, 'no_ops' when the row exists but has no ops.
    jcComputedStatus: r.jcExists
      ? (r.jcComputedStatus as ProductionOrderListItem['jcComputedStatus'])
      : null,
    jcFinishedQty: Number(r.jcFinishedQty ?? 0),
    jcClosedAt: toIso(r.jcClosedAt),
    partyName: r.partyName ?? null,
    rawMaterialGradeText: r.rawMaterialGradeText ?? null,
    rawMaterialSizeText: r.rawMaterialSizeText ?? null,
    createdByName: r.createdByName ?? null,
    closedByName: r.closedByName ?? null,
    shortClosedByName: r.shortClosedByName ?? null,
  };
}

/** The "may this be closed?" sentence lives in lib/production-order-close-guard.ts
 *  (pure, unit-tested). The detail view shows it as `closeBlockedReason`; Close
 *  throws exactly the same words, so what the screen says and what the server
 *  refuses can never differ. `jcSettledWithLosses` is read separately
 *  (readJcSettledWithLosses) and folded in — it never travels to the browser. */
function toDetail(
  item: ProductionOrderListItem,
  jcSettledWithLosses: boolean,
  closes: ProductionOrderClose[],
): ProductionOrderDetail {
  const credited = item.creditedQty ?? 0;
  const reason = closeBlockedReason({ ...item, jcSettledWithLosses, creditedQty: credited });
  const availableToClose = Math.max(0, item.jcFinishedQty - credited);
  const remainingQty = Math.max(0, item.orderQty - credited);
  return {
    ...item,
    canClose: reason === null,
    closeBlockedReason: reason,
    availableToClose,
    remainingQty,
    closes,
  };
}

/** The close ledger for one PO, newest first. Reads the running history the
 *  detail view + reversal need (ADR-179). */
async function readClosesInTx(
  tx: DbTransaction,
  productionOrderId: string,
  companyId: string,
): Promise<ProductionOrderClose[]> {
  const closedByUserC = alias(users, 'po_close_by');
  const rows = await tx
    .select({
      id: productionOrderCloses.id,
      productionOrderId: productionOrderCloses.productionOrderId,
      qty: productionOrderCloses.qty,
      isReversal: productionOrderCloses.isReversal,
      reversesCloseId: productionOrderCloses.reversesCloseId,
      lostQty: productionOrderCloses.lostQty,
      remarks: productionOrderCloses.remarks,
      closedAt: productionOrderCloses.createdAt,
      closedBy: productionOrderCloses.createdBy,
      closedByName: closedByUserC.fullName,
    })
    .from(productionOrderCloses)
    .leftJoin(closedByUserC, eq(closedByUserC.id, productionOrderCloses.createdBy))
    .where(
      and(
        eq(productionOrderCloses.productionOrderId, productionOrderId),
        eq(productionOrderCloses.companyId, companyId),
        isNull(productionOrderCloses.deletedAt),
      ),
    )
    .orderBy(desc(productionOrderCloses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    productionOrderId: r.productionOrderId,
    qty: r.qty,
    isReversal: r.isReversal,
    reversesCloseId: r.reversesCloseId ?? null,
    lostQty: r.lostQty ?? null,
    remarks: r.remarks ?? null,
    closedAt: toIso(r.closedAt) ?? '',
    closedBy: r.closedBy,
    closedByName: r.closedByName ?? null,
  }));
}

/** The settled-with-losses rule for one PO's JC, evaluated on demand. Skipped
 *  (false) when the PO is already closed or the JC already reads complete /
 *  closed — the guard is decided without it there, and the rule is the
 *  heaviest read in this module (SETTLED_RULE_DEPTH nested copies). */
async function readJcSettledWithLosses(
  tx: DbTransaction,
  item: ProductionOrderListItem,
): Promise<boolean> {
  if (item.status === 'closed' || item.status === 'short_closed') return false;
  if (item.jcComputedStatus === 'complete' || item.jcComputedStatus === 'closed') return false;
  const rows = (await tx.execute(
    sql`SELECT ${jcSettledWithLossesSql(sql`${item.jobCardId}::uuid`)} AS settled`,
  )) as unknown as Array<{ settled: boolean }>;
  return rows[0]?.settled === true;
}

/** Close-time snapshot: the settled flag AND the finished qty in ONE statement,
 *  so a QC accept committed between two reads can never leave the flag saying
 *  "settled" while the qty credited is the older, smaller number (the extra
 *  piece would then never be credited — its own qc_accept credit is switched
 *  off for a PO-linked JC). READ COMMITTED sees one snapshot per statement. */
async function readCloseSnapshot(
  tx: DbTransaction,
  jobCardId: string,
): Promise<{ settled: boolean; finishedQty: number; computedStatus: string | null }> {
  const jc = sql`${jobCardId}::uuid`;
  const rows = (await tx.execute(sql`
    SELECT ${jcSettledWithLossesSql(jc)} AS settled,
           ${lastOpFinishedQtySql(jc)} AS finished_qty,
           (SELECT s.computed_status FROM public.v_jc_status s WHERE s.job_card_id = ${jc}) AS computed_status
  `)) as unknown as Array<{
    settled: boolean;
    finished_qty: number;
    computed_status: string | null;
  }>;
  const r = rows[0];
  return {
    settled: r?.settled === true,
    finishedQty: Number(r?.finished_qty ?? 0),
    computedStatus: r?.computed_status ?? null,
  };
}

function baseQuery(tx: DbTransaction) {
  return tx
    .select(poColumns)
    .from(productionOrders)
    .leftJoin(jobCards, eq(jobCards.id, productionOrders.jobCardId))
    .leftJoin(plans, eq(plans.id, productionOrders.planId))
    .leftJoin(createdByUser, eq(createdByUser.id, productionOrders.createdBy))
    .leftJoin(closedByUser, eq(closedByUser.id, productionOrders.closedBy))
    .leftJoin(shortClosedByUser, eq(shortClosedByUser.id, productionOrders.shortClosedBy));
}

async function readDetailInTx(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<ProductionOrderDetail> {
  const rows = await baseQuery(tx)
    .where(
      and(
        eq(productionOrders.id, id),
        eq(productionOrders.companyId, companyId),
        isNull(productionOrders.deletedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Production Order ${id} not found`);
  const item = toListItem(row as PoRow);
  const [settled, closes] = await Promise.all([
    readJcSettledWithLosses(tx, item),
    readClosesInTx(tx, id, companyId),
  ]);
  return toDetail(item, settled, closes);
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listProductionOrders(
  query: ListProductionOrdersQuery,
  user: AuthContext,
): Promise<ListProductionOrdersResponse> {
  await requireFormAccess(user, 'prodorder_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [
      eq(productionOrders.companyId, companyId),
      isNull(productionOrders.deletedAt),
    ];
    if (query.status) conditions.push(eq(productionOrders.status, query.status));
    if (query.planId) conditions.push(eq(productionOrders.planId, query.planId));
    if (query.jobCardId) conditions.push(eq(productionOrders.jobCardId, query.jobCardId));
    if (query.search) {
      // Every code a user might have in hand for this order: the PO itself, the
      // plan, the item (code or name), the Job Card, the SO / JWSO. All are
      // snapshots on the row, so no join is needed to search them.
      const term = `%${escapeLikeTerm(query.search)}%`;
      const s = or(
        sql`${productionOrders.code} ILIKE ${term}`,
        sql`${productionOrders.planCodeText} ILIKE ${term}`,
        sql`${productionOrders.itemCodeText} ILIKE ${term}`,
        sql`${productionOrders.itemNameText} ILIKE ${term}`,
        sql`${productionOrders.jcCodeText} ILIKE ${term}`,
        sql`${productionOrders.soCodeText} ILIKE ${term}`,
        // POL — the customer's own PO line number, now a column on this list.
        // Written as its own correlated subquery off production_orders.plan_id
        // rather than reusing CLIENT_PO_LINE_NO_SQL, because that fragment
        // reads the `plans` alias which only baseQuery joins; this predicate is
        // also handed to the count() query below, which selects from
        // production_orders alone. Same shape as PARTY_NAME_SQL for that
        // reason. SO side only: a JWSO-sourced order has no customer PO line.
        sql`(
          SELECT sol.client_po_line_no
            FROM public.plans p
            JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
           WHERE p.id = ${productionOrders.planId} LIMIT 1
        ) ILIKE ${term}`,
      );
      if (s) conditions.push(s);
    }
    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      baseQuery(tx)
        .where(where)
        // Newest first; code as the tie-break keeps paging stable.
        .orderBy(desc(productionOrders.createdAt), desc(productionOrders.code))
        .limit(query.limit)
        .offset(query.offset),
      tx.select({ value: count() }).from(productionOrders).where(where),
    ]);

    return {
      items: rows.map((r) => toListItem(r as PoRow)),
      total: totals[0]?.value ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  });
}

export async function getProductionOrder(
  id: string,
  user: AuthContext,
): Promise<ProductionOrderDetail> {
  await requireFormAccess(user, 'prodorder_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => readDetailInTx(tx, id, companyId));
}

export async function getNextProductionOrderCode(
  user: AuthContext,
): Promise<NextProductionOrderCodeResponse> {
  await requireFormAccess(user, 'prodorder_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({
    code: await nextProductionOrderCode(tx, companyId),
  }));
}

// ─── Create: Plan + Route Card + Target Date → Job Card ───────────────────

export async function createProductionOrder(
  input: CreateProductionOrderInput,
  user: AuthContext,
): Promise<ProductionOrderDetail> {
  await requireFormAccess(user, 'prodorder_create', 'entry');
  const companyId = requireCompany(user);

  // ADR-182 — no material, no order. Checked before anything is read or
  // written, and worded exactly as the screen words it.
  if (input.rawMaterialAvailable !== true) {
    throw new ValidationError('No raw material — you cannot create the production order.');
  }
  const actualSize = input.actualSize?.trim() ? input.actualSize.trim() : null;

  // withUniqueRetry: two users creating orders for DIFFERENT plans at the same
  // moment can both compute the same next IN-PRO-##### — the loser's whole
  // transaction (JC, ops, OSP PRs) rolls back and re-runs with the next number.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // Row-lock the plan: two clicks on Create must not both read the same
      // "covered" figure and each build a Job Card for the whole Pending qty.
      // The second waits, re-reads the SUM below, and is refused if its qty no
      // longer fits (ADR-182 — the unique index on plan_id is gone, this lock
      // IS the cap's safety).
      const planRows = await tx
        .select()
        .from(plans)
        .where(
          and(eq(plans.id, input.planId), eq(plans.companyId, companyId), isNull(plans.deletedAt)),
        )
        .limit(1)
        .for('update');
      const plan = planRows[0];
      if (!plan) throw new NotFoundError(`Plan ${input.planId} not found`);

      if (plan.opsSource !== 'route_card') {
        throw new ValidationError(
          `Plan ${plan.code} is an old-style plan with its own operations — use Execute on the plan instead`,
        );
      }
      // ADR-182 — the qty cap, read INSIDE the plan's row lock above so two
      // concurrent creates can never both fit. ADR-184 — Covered is the ONE
      // definition in lib/plan-order-coverage.ts: an open / partly closed order
      // covers its Order Qty, a closed or short-closed one only what it
      // credited, so the pieces a stopped order did not deliver are Pending.
      //
      // Checked BEFORE the plan-status guard below on purpose: a fully-covered
      // plan is stamped 'jc_created' the moment its last order is created (see
      // the write below), so for that exact plan the status guard would fire
      // first and show the user an internal status name instead of the plain
      // "fully covered" sentence this cap exists to give them. Every other
      // refusal is unaffected — if the qty still fits, capError is null and the
      // status guard fires next exactly as before.
      const { coveredQty: covered } = await readPlanOrderCoverage(tx, plan.id);
      const capError = productionOrderCapError(plan.code, plan.planQty, covered, input.orderQty);
      if (capError) throw new ValidationError(capError);
      const coverage = planCoverage(plan.planQty, covered + input.orderQty);

      if (plan.planStatus !== 'planned') {
        throw new ValidationError(
          `Plan ${plan.code} is '${plan.planStatus}' — only a planned plan can be turned into a Production Order`,
        );
      }

      if (!plan.itemId) {
        throw new ValidationError(
          `Plan ${plan.code} has no master item — pick the item from Item Master on the plan first`,
        );
      }
      const itemId = plan.itemId;
      const itemLabel = plan.itemCodeText ?? itemId;

      // Route card: must be THE active card of the plan's item, with at least
      // one live operation. "No route card, no way forward."
      const rcRows = await tx
        .select({
          id: routeCards.id,
          code: routeCards.code,
          itemId: routeCards.itemId,
          currentRevision: routeCards.currentRevision,
          planType: routeCards.planType,
        })
        .from(routeCards)
        .where(
          and(
            eq(routeCards.id, input.routeCardId),
            eq(routeCards.companyId, companyId),
            isNull(routeCards.deletedAt),
          ),
        )
        .limit(1);
      const rc = rcRows[0];
      if (!rc) {
        // Say whether the ITEM has a card at all, so the message tells the user
        // what to do next rather than only that the id was wrong.
        const anyForItem = await tx
          .select({ id: routeCards.id })
          .from(routeCards)
          .where(
            and(
              eq(routeCards.companyId, companyId),
              eq(routeCards.itemId, itemId),
              isNull(routeCards.deletedAt),
            ),
          )
          .limit(1);
        if (!anyForItem[0]) {
          throw new ValidationError(
            `No route card for this item — create it in Item Master first (${itemLabel})`,
          );
        }
        throw new NotFoundError(`Route card ${input.routeCardId} not found or no longer active`);
      }
      if (rc.itemId !== itemId) {
        throw new ValidationError(`Route card ${rc.code} is not for item ${itemLabel}`);
      }

      const rcOps = await tx
        .select()
        .from(routeCardOps)
        .where(and(eq(routeCardOps.routeCardId, rc.id), isNull(routeCardOps.deletedAt)))
        .orderBy(asc(routeCardOps.opSeq));
      if (rcOps.length === 0) {
        throw new ValidationError(
          `Route card ${rc.code} has no operations — add them in Item Master first`,
        );
      }
      // Same routing rule Execute applies to a plan's ops: a QC op may not sit
      // directly after an outsource op.
      assertNoQcDirectlyAfterOutsource(rcOps);

      // The route card decides HOW the item is made (`route_cards.plan_type`,
      // migration 0123) — the plan only carries a copy. Re-stamp the plan from
      // the card now, so the plan and the Job Card built from it agree with the
      // card as it stands today, not as it stood when the plan was typed.
      await tx
        .update(plans)
        .set({ planType: rc.planType, updatedAt: new Date(), updatedBy: user.id })
        .where(eq(plans.id, plan.id));

      if (rc.planType === 'direct_purchase') {
        // A bought item has nothing to produce. What (if anything) a Production
        // Order should do for it is still the user's call; until then the branch
        // refuses in plain words rather than building a Job Card with no work.
        throw new ValidationError(
          'Direct-purchase items are bought, not produced — this route card cannot raise a Production Order yet',
        );
      }
      if (rc.planType === 'full_outsource' && !rcOps.some((op) => op.opType === 'outsource')) {
        // A full-outsource card is built by the same steps (the builder raises
        // the IN-JWPR for each outsource op and adds no terminal QC, since the
        // OSP return is inspected at Incoming QC) — but only if there IS an
        // outsource op to raise it for.
        throw new ValidationError('Full-outsource route card must have an outsource operation');
      }

      // route_card_ops → the builder's op shape. Same field mapping as
      // plans/service getDefaultRouteOpsForItem (osp_vendor_* → outsource_vendor_*,
      // cost 0), kept as stored text so nothing is re-rounded.
      const ops: JcBuildOp[] = rcOps.map((op) => ({
        opSeq: op.opSeq,
        machineId: op.machineId,
        machineCodeText: op.machineCodeText,
        operation: op.operation,
        opType: op.opType,
        cycleTimeMin: op.cycleTimeMin,
        program: op.program,
        toolNo: op.toolNo,
        toolDetails: op.toolDetails,
        qcRequired: op.qcRequired,
        outsourceVendorId: op.ospVendorId,
        outsourceVendorText: op.ospVendorCodeText,
        outsourceCost: '0',
      }));

      // Build the Job Card by exactly the steps Execute uses (JC row, ops copied,
      // default terminal QC, OSP PRs) — with the target date as the JC's due
      // date and NO route-card write-back (the card is the source here).
      const built = await buildJobCardFromOps(tx, {
        plan: { ...plan, itemId },
        ops,
        user,
        companyId,
        dueDate: input.targetDate,
        // ADR-182: the card is built for THIS order's qty, not for the whole
        // plan — 20 of a 50 plan makes a 20-piece Job Card.
        orderQty: input.orderQty,
        actualSize,
      });
      const jc = built.jc;

      // ADR-182 — the plan only leaves 'planned' once it is FULLY covered.
      // `createProductionOrder` refuses a plan that is not 'planned', so
      // stamping 'jc_created' on the first of several orders would lock the
      // plan out of the very batching this ADR adds. Pending 0 means nothing
      // more can be raised, so the old label is correct again there.
      await tx
        .update(plans)
        .set({
          ...(coverage.pendingQty === 0 ? { planStatus: 'jc_created' as const } : {}),
          jcId: jc.id,
          updatedAt: new Date(),
          updatedBy: user.id,
        })
        .where(eq(plans.id, plan.id));

      const code = await nextProductionOrderCode(tx, companyId);
      const inserted = await tx
        .insert(productionOrders)
        .values({
          companyId,
          code,
          status: 'open',
          planId: plan.id,
          planCodeText: plan.code,
          soCodeText: plan.soCodeText,
          lineNo: plan.lineNo,
          itemId,
          itemCodeText: plan.itemCodeText ?? itemLabel,
          itemNameText: plan.itemNameText,
          routeCardId: rc.id,
          routeCardCodeText: rc.code,
          routeCardRevision: rc.currentRevision,
          jobCardId: jc.id,
          jcCodeText: jc.code,
          orderQty: input.orderQty,
          targetDate: input.targetDate,
          rawMaterialAvailable: true,
          actualSize,
          remarks: input.remarks ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: productionOrders.id });
      const po = inserted[0]!;

      // The JC was inserted before the PO row existed, so the back-link — the
      // OFF switch the stock cascades read — is set now.
      await tx
        .update(jobCards)
        .set({ productionOrderId: po.id, updatedBy: user.id })
        .where(eq(jobCards.id, jc.id));

      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'Production Order',
          detail:
            `${code} — ${plan.code} + ${rc.code} (Rev ${rc.currentRevision}) → JC ${jc.code}, ` +
            `${ops.length} ops, Order Qty ${input.orderQty} ` +
            `(plan ${plan.planQty}, covered ${coverage.coveredQty}, pending ${coverage.pendingQty})` +
            (built.raisedPrCodes.length > 0 ? ` + OSP PR ${built.raisedPrCodes.join(', ')}` : ''),
          refId: code,
        },
        companyId,
        user,
      );

      return readDetailInTx(tx, po.id, companyId);
    }),
  );
}

// ─── Close: credit stock as pieces finish (partial close, ADR-179) ─────────

/** Write ONE store_transactions row for a close (or its reversal) and return
 *  its id. Same columns/locking as the qc_accept credit in
 *  op-entry/qc-stock-cascade.ts: the items row is locked first to serialise
 *  concurrent stock writes on the same item, and before/after come from
 *  v_item_stock so the ledger stays a running total. */
async function writeCloseStockTxn(
  tx: DbTransaction,
  args: {
    companyId: string;
    itemId: string;
    txnType: 'in' | 'out';
    qty: number;
    sourceRef: string;
    remarks: string;
    userId: string;
  },
): Promise<string> {
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${args.itemId}::uuid FOR UPDATE`);
  const balanceRows = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${args.companyId}::uuid AND item_id = ${args.itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const before = Number(balanceRows[0]?.on_hand ?? 0);
  const after = args.txnType === 'in' ? before + args.qty : before - args.qty;
  const ins = await tx
    .insert(storeTransactions)
    .values({
      companyId: args.companyId,
      txnDate: new Date().toISOString().slice(0, 10),
      itemId: args.itemId,
      txnType: args.txnType,
      qty: args.qty,
      sourceType: 'production_order_close',
      sourceRef: args.sourceRef,
      stockBefore: before,
      stockAfter: after,
      remarks: args.remarks,
      createdBy: args.userId,
    })
    .returning({ id: storeTransactions.id });
  return ins[0]!.id;
}

/**
 * ADR-180 §D — book the pieces a close just credited to the order that asked
 * for them, automatically.
 *
 * Without this the finished goods land in free stock and the next dispatch for
 * ANY customer can take them: the order that paid for the production run loses
 * its own output. The booking moves nothing — the pieces stay on the shelf —
 * it only marks them as spoken for.
 *
 * Three things make it safe to run on every close:
 *   - the close row's id goes on the booking, and that column is UNIQUE while
 *     live, so a replayed close cannot book the same pieces twice;
 *   - the qty is capped by what the order line still needs, so a line already
 *     covered by stock or dispatches books nothing;
 *   - a plan with no sales-order line behind it (job work, make-to-stock)
 *     simply books nothing and says so by returning 0.
 *
 * It runs in the close's own transaction: if the booking cannot be written the
 * whole close is rolled back rather than leaving stock credited but unbooked.
 */
async function autoReserveClosedStock(
  tx: DbTransaction,
  args: {
    companyId: string;
    planId: string;
    itemId: string;
    productionOrderId: string;
    jobCardId: string;
    productionOrderCloseId: string;
    qty: number;
  },
  user: AuthContext,
): Promise<{ qty: number; soCodeText: string; lineNo: number } | null> {
  if (args.qty <= 0) return null;

  const lines = await tx
    .select({
      soLineId: salesOrderLines.id,
      lineNo: salesOrderLines.lineNo,
      soCode: salesOrders.code,
    })
    .from(plans)
    .innerJoin(
      salesOrderLines,
      and(eq(salesOrderLines.id, plans.soLineId), isNull(salesOrderLines.deletedAt)),
    )
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .where(and(eq(plans.id, args.planId), isNull(plans.deletedAt)))
    .limit(1);
  const line = lines[0];
  if (!line) return null;

  // The plan's SO line must actually be for the item this order made. A
  // BOM-CHILD plan carries the PARENT's so_line_id with a CHILD item, so
  // booking here would park child stock on the parent line. Skip quietly
  // rather than throw: a close must never fail because there was nobody to
  // promise the goods to — the stock is credited either way and a planner can
  // still allocate it by hand.
  const lineItemId = await readLineItemId(tx, line.soLineId);
  if (lineItemId !== null && lineItemId !== args.itemId) return null;

  const need = (await readUnreservedRequirement(tx, args.companyId, line.soLineId)) ?? 0;
  // Also capped by what is genuinely free. The credit above makes this a
  // formality, but if the item's books are already over-committed (a manual
  // adjustment took stock the bookings were holding) a close must not be the
  // thing that fails — it books what it can and no more.
  const free = (await readStockPosition(tx, args.companyId, args.itemId)).availableQty;
  const qty = Math.min(args.qty, need, free);
  if (qty <= 0) return null;

  const created = await createReservation(
    tx,
    {
      companyId: args.companyId,
      soLineId: line.soLineId,
      soCodeText: line.soCode,
      lineNo: line.lineNo,
      itemId: args.itemId,
      itemCodeText: await itemCodeFor(tx, args.itemId),
      qty,
      source: 'auto_production',
      productionOrderId: args.productionOrderId,
      jobCardId: args.jobCardId,
      productionOrderCloseId: args.productionOrderCloseId,
      // The requirement cap was applied above, against the same figures.
      skipRequirementCap: true,
    },
    user,
  );
  if (!created) return null;
  return { qty: created.qty, soCodeText: line.soCode, lineNo: line.lineNo };
}

export async function closeProductionOrder(
  id: string,
  input: CloseProductionOrderInput,
  user: AuthContext,
): Promise<ProductionOrderDetail> {
  await requireFormAccess(user, 'prodorder_create', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Lock the PO row so a double-clicked Close cannot credit stock twice: the
    // second waits, re-reads 'closed', and is refused.
    const locked = await tx
      .select({
        id: productionOrders.id,
        status: productionOrders.status,
        jobCardId: productionOrders.jobCardId,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!locked[0]) throw new NotFoundError(`Production Order ${id} not found`);
    // ADR-182 — a short-closed order is dead. Refused before anything is read
    // or written, in the same words every other stopped-order refusal uses.
    await assertProductionOrderNotShortClosed(tx, locked[0].jobCardId);
    if (locked[0].status === 'closed') {
      throw new ConflictError('Production Order is already fully closed');
    }

    // Live progress, read AFTER the lock. The guard inputs (settled flag,
    // finished qty, JC status) come from ONE statement so the qty credited is
    // exactly the qty the guard judged.
    const current = await readDetailInTx(tx, id, companyId);
    const snap = await readCloseSnapshot(tx, current.jobCardId);
    const alreadyCredited = current.creditedQty ?? 0;
    const reason = closeBlockedReason({
      status: current.status,
      jcCodeText: current.jcCodeText,
      jcComputedStatus: (snap.computedStatus ??
        current.jcComputedStatus) as ProductionOrderListItem['jcComputedStatus'],
      jcFinishedQty: snap.finishedQty,
      jcSettledWithLosses: snap.settled,
      creditedQty: alreadyCredited,
    });
    if (reason) throw new ValidationError(reason);

    // available = finished so far − already credited. Capped live off the JC's
    // output, NEVER the plan qty, so a close can never credit more than made.
    const available = Math.max(0, snap.finishedQty - alreadyCredited);
    const st = snap.computedStatus ?? current.jcComputedStatus ?? 'no_ops';
    const jcDone = st === 'complete' || st === 'closed' || snap.settled;

    let creditNow: number;
    if (input.finish) {
      // Close short: finish the order now. Only when the JC is truly done —
      // otherwise pieces still to come would be wrongly written off as lost.
      if (!jcDone) {
        throw new ValidationError(
          `Cannot finish Production Order ${current.code} — Job Card ${current.jcCodeText} is not complete yet (${st}). Close finished pieces as they clear, or wait until the order is done.`,
        );
      }
      // Finish credits ALL finished pieces now; only the never-made remainder is
      // written off as lost. A supplied qty is ignored on finish so good pieces
      // can never be silently marked lost (review finding).
      creditNow = available;
    } else {
      // Ordinary partial close: credit finished pieces now, leave the rest open.
      // Does NOT require the JC to be complete.
      if (available <= 0) {
        throw new ValidationError(
          `No finished pieces available to close for Production Order ${current.code} — Job Card ${current.jcCodeText} has finished ${snap.finishedQty}, all credited. Close more as its operations clear.`,
        );
      }
      creditNow = input.qty === undefined ? available : input.qty;
    }
    if (creditNow > available) {
      throw new ValidationError(
        `Cannot close ${creditNow} — only ${available} finished piece(s) are available (JC ${current.jcCodeText} finished ${snap.finishedQty}, ${alreadyCredited} already credited).`,
      );
    }

    // Filled in by the automatic booking below, when there was one to make.
    let autoReserved: { qty: number; soCodeText: string; lineNo: number } | null = null;

    const newCredited = alreadyCredited + creditNow;
    const finalStatus: 'partially_closed' | 'closed' =
      input.finish || newCredited >= current.orderQty ? 'closed' : 'partially_closed';
    const lostQty: number | null = input.finish
      ? Math.max(0, current.orderQty - newCredited)
      : null;

    // A unique store-ledger ref per close: the PO code + the close sequence.
    const priorCloses =
      (
        (await tx.execute(sql`
          SELECT COUNT(*)::int AS n FROM public.production_order_closes
          WHERE production_order_id = ${id}::uuid AND deleted_at IS NULL
        `)) as unknown as Array<{ n: number }>
      )[0]?.n ?? 0;
    const seq = priorCloses + 1;

    if (creditNow > 0) {
      const storeTxnId = await writeCloseStockTxn(tx, {
        companyId,
        itemId: current.itemId,
        txnType: 'in',
        qty: creditNow,
        sourceRef: `${current.code}#${seq}`,
        remarks: `Production Order ${current.code} close #${seq} — JC ${current.jcCodeText} credited ${creditNow} (${newCredited} of ${current.orderQty})`,
        userId: user.id,
      });
      const closeRows = await tx
        .insert(productionOrderCloses)
        .values({
          companyId,
          productionOrderId: id,
          qty: creditNow,
          isReversal: false,
          lostQty: input.finish ? lostQty : null,
          storeTxnId,
          remarks: input.remarks ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: productionOrderCloses.id });

      // ADR-180 §D — book the pieces just credited to the order that ordered
      // them. Same transaction as the close and the stock credit: the three
      // either all happen or none do. A close-short that credits nothing never
      // reaches here, and a reversal has its own path.
      autoReserved = await autoReserveClosedStock(
        tx,
        {
          companyId,
          planId: current.planId,
          itemId: current.itemId,
          productionOrderId: id,
          jobCardId: current.jobCardId,
          productionOrderCloseId: closeRows[0]!.id,
          qty: creditNow,
        },
        user,
      );
    }

    const now = new Date();
    const writeOrder = async (): Promise<void> => {
      await tx
        .update(productionOrders)
        .set({
          status: finalStatus,
          creditedQty: newCredited,
          ...(input.finish ? { lostQty } : {}),
          ...(finalStatus === 'closed' ? { closedAt: now, closedBy: user.id } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(productionOrders.id, id));
    };
    // ADR-184 — once the order is 'closed' it covers only what it credited, so
    // a finish-close with losses gives the lost pieces back to the plan's
    // Pending; re-open the plan for them exactly as short close does. A
    // partial close leaves the order covering its full qty — no plan change.
    let planShift: PlanPendingShift | null = null;
    if (finalStatus === 'closed') {
      planShift = await shiftPlanPending(
        tx,
        { planId: current.planId, companyId, poCode: current.code, how: 'finish-close', user },
        writeOrder,
      );
    } else {
      await writeOrder();
    }

    // Close the JC only when the ORDER is fully closed; a partial close leaves
    // it open. One already closed (by the sales cascade) keeps its close time.
    if (finalStatus === 'closed' && current.jcClosedAt === null) {
      await tx
        .update(jobCards)
        .set({ closedAt: now, updatedBy: user.id })
        .where(and(eq(jobCards.id, current.jobCardId), isNull(jobCards.closedAt)));
    }

    await emitActivityLog(
      tx,
      {
        action: 'CLOSE',
        entity: 'Production Order',
        detail: input.finish
          ? `${current.code} finished — JC ${current.jcCodeText} credited ${creditNow} (${newCredited} of ${current.orderQty}), ${lostQty ?? 0} lost` +
            (planShift && planShift.pendingAfter !== planShift.pendingBefore
              ? `; returned ${planShift.pendingAfter - planShift.pendingBefore} to plan ${planShift.planCode} (Pending ${planShift.pendingBefore} → ${planShift.pendingAfter})`
              : '')
          : `${current.code} ${finalStatus === 'closed' ? 'closed' : 'partial close'} — JC ${current.jcCodeText} credited ${creditNow} (${newCredited} of ${current.orderQty})`,
        refId: current.code,
      },
      companyId,
      user,
    );

    if (autoReserved) {
      await emitActivityLog(
        tx,
        {
          action: 'UPDATE',
          entity: 'Reservation',
          detail:
            `${autoReserved.soCodeText} L${autoReserved.lineNo} — ${autoReserved.qty} reserved ` +
            `automatically from ${current.code} close #${seq} (stock stays on the shelf)`,
          refId: autoReserved.soCodeText,
        },
        companyId,
        user,
      );
    }

    return readDetailInTx(tx, id, companyId);
  });
}

// ─── Reverse one close: compensating stock-out + ledger row (ADR-179) ──────

export async function reverseProductionOrderClose(
  id: string,
  input: ReverseProductionOrderCloseInput,
  user: AuthContext,
): Promise<ProductionOrderDetail> {
  await requireFormAccess(user, 'prodorder_create', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Lock the PO so the reversal and its status recompute are atomic against a
    // concurrent close.
    const locked = await tx
      .select({
        id: productionOrders.id,
        status: productionOrders.status,
        creditedQty: productionOrders.creditedQty,
        orderQty: productionOrders.orderQty,
        itemId: productionOrders.itemId,
        code: productionOrders.code,
        jcCodeText: productionOrders.jcCodeText,
        jobCardId: productionOrders.jobCardId,
        planId: productionOrders.planId,
        planCodeText: productionOrders.planCodeText,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const po = locked[0];
    if (!po) throw new NotFoundError(`Production Order ${id} not found`);
    // ADR-182 — nothing may be undone on a stopped order either: its credited
    // pieces stay credited exactly as they were when it was short closed.
    await assertProductionOrderNotShortClosed(tx, po.jobCardId);

    // The close row being reversed must belong to this PO, be a real close (not
    // itself a reversal) and not already reversed.
    const closeRows = await tx
      .select({
        id: productionOrderCloses.id,
        qty: productionOrderCloses.qty,
        isReversal: productionOrderCloses.isReversal,
      })
      .from(productionOrderCloses)
      .where(
        and(
          eq(productionOrderCloses.id, input.closeId),
          eq(productionOrderCloses.productionOrderId, id),
          eq(productionOrderCloses.companyId, companyId),
          isNull(productionOrderCloses.deletedAt),
        ),
      )
      .limit(1);
    const close = closeRows[0];
    if (!close)
      throw new NotFoundError(`Close ${input.closeId} not found on this Production Order`);
    if (close.isReversal) throw new ValidationError('That entry is itself a reversal.');
    const priorReversal = await tx
      .select({ id: productionOrderCloses.id })
      .from(productionOrderCloses)
      .where(
        and(
          eq(productionOrderCloses.reversesCloseId, close.id),
          isNull(productionOrderCloses.deletedAt),
        ),
      )
      .limit(1);
    if (priorReversal[0]) throw new ValidationError('This close has already been reversed.');

    // ADR-184 — a 'closed' order covers only what it credited, so its lost
    // pieces went back to the plan's Pending and may already sit on a remake
    // order. Reversing re-opens this order to its FULL Order Qty; refuse when
    // that would cover the plan past its Plan Qty (the same plan lock
    // createProductionOrder takes, so the two cannot interleave).
    if (po.status === 'closed' && po.planId) {
      const planRows = await tx
        .select({ planQty: plans.planQty })
        .from(plans)
        .where(
          and(eq(plans.id, po.planId), eq(plans.companyId, companyId), isNull(plans.deletedAt)),
        )
        .limit(1)
        .for('update');
      const planQty = Number(planRows[0]?.planQty ?? 0);
      const { coveredQty, orderCodes } = await readPlanOrderCoverage(tx, po.planId);
      const coveredAfter = coveredQty - (po.creditedQty ?? 0) + po.orderQty;
      if (coveredAfter > planQty) {
        const others = orderCodes.filter((c) => c !== po.code);
        throw new ConflictError(
          `Cannot reverse — ${po.code} would re-open for its full ${po.orderQty} and cover plan ${po.planCodeText ?? ''} ${coveredAfter} of ${planQty}. ` +
            `Its lost pieces are already on ${others.length ? others.join(', ') : 'another order'}; short close that order first.`,
        );
      }
    }

    // ADR-180 §D — the automatic booking this close created goes back first.
    // Its pieces are about to leave stock again, so the order must stop holding
    // them; if any have already shipped this refuses and names the dispatch
    // rather than quietly un-booking goods that are on a lorry.
    const unbooked = await releaseReservationForClose(
      tx,
      {
        companyId,
        productionOrderCloseId: close.id,
        reason: 'production close reversed',
      },
      user,
    );

    // Guard: the pieces must still be on hand — a reversal that would drive
    // stock negative means they were already dispatched.
    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${po.itemId}::uuid FOR UPDATE`);
    const onHandRows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${po.itemId}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const onHand = Number(onHandRows[0]?.on_hand ?? 0);
    if (onHand < close.qty) {
      throw new ConflictError(
        `Cannot reverse ${close.qty} — only ${onHand} on hand for ${po.code}. Those pieces have already been dispatched; reverse the dispatch first.`,
      );
    }

    // A unique store-ledger ref per reversal (the ledger row count gives the
    // sequence), so two reversals of one PO never share a sourceRef.
    const ledgerCount =
      (
        (await tx.execute(sql`
          SELECT COUNT(*)::int AS n FROM public.production_order_closes
          WHERE production_order_id = ${id}::uuid AND deleted_at IS NULL
        `)) as unknown as Array<{ n: number }>
      )[0]?.n ?? 0;
    const storeTxnId = await writeCloseStockTxn(tx, {
      companyId,
      itemId: po.itemId,
      txnType: 'out',
      qty: close.qty,
      sourceRef: `${po.code}#rev${ledgerCount + 1}`,
      remarks: `Production Order ${po.code} — reversed close of ${close.qty}`,
      userId: user.id,
    });
    await tx.insert(productionOrderCloses).values({
      companyId,
      productionOrderId: id,
      qty: close.qty,
      isReversal: true,
      reversesCloseId: close.id,
      storeTxnId,
      remarks: input.remarks ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    });

    const newCredited = Math.max(0, (po.creditedQty ?? 0) - close.qty);
    // A reversal re-opens the order: it can never leave it 'closed' with fewer
    // pieces credited than ordered.
    const finalStatus: 'open' | 'partially_closed' | 'closed' =
      newCredited <= 0 ? 'open' : newCredited >= po.orderQty ? 'closed' : 'partially_closed';
    const now = new Date();
    const writeReversal = async (): Promise<void> => {
      await tx
        .update(productionOrders)
        .set({
          status: finalStatus,
          creditedQty: newCredited,
          // Re-opening clears any short-close loss + close stamps.
          ...(finalStatus === 'closed' ? {} : { lostQty: null, closedAt: null, closedBy: null }),
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(productionOrders.id, id));
    };
    // ADR-184 — a reversal can move the plan's Pending both ways (a 'closed'
    // order covering only its credit goes back to its full Order Qty), so the
    // plan's stored status is re-stamped by the same helper the closes use.
    if (po.planId) {
      await shiftPlanPending(
        tx,
        { planId: po.planId, companyId, poCode: po.code, how: 'close reversal', user },
        writeReversal,
      );
    } else {
      await writeReversal();
    }

    // A reversal that re-opens the order must also re-open its Job Card — the
    // original full close stamped jobCards.closedAt, and leaving the JC closed
    // while the PO is open is an inconsistent state (review finding).
    if (finalStatus !== 'closed') {
      await tx
        .update(jobCards)
        .set({ closedAt: null, updatedBy: user.id })
        .where(eq(jobCards.id, po.jobCardId));
    }

    await emitActivityLog(
      tx,
      {
        action: 'REVERSE',
        entity: 'Production Order',
        detail:
          `${po.code} — reversed close of ${close.qty} (now ${newCredited} of ${po.orderQty} credited)` +
          (unbooked > 0 ? `, ${unbooked} reservation released` : ''),
        refId: po.code,
      },
      companyId,
      user,
    );

    return readDetailInTx(tx, id, companyId);
  });
}

// ─── Plan Pending shift on a stop (ADR-184) ───────────────────────────────

/** What a stop did to the order's plan, read off the data itself. */
interface PlanPendingShift {
  planCode: string;
  pendingBefore: number;
  pendingAfter: number;
  reopened: boolean;
}

/**
 * ADR-184 — run `write` (the production_orders update that stops or finishes
 * an order) between two reads of the plan's Pending, under the plan's row
 * lock — the SAME lock `createProductionOrder` takes, so a create running at
 * this moment either sees the order still covering its full qty or waits and
 * re-reads the freed Pending. Never both.
 *
 * When the new Pending is > 0 the plan goes back to 'planned' (the one status
 * Create accepts) if it was 'jc_created' — otherwise the freed qty would show
 * as Pending everywhere yet be un-orderable. Nothing else about the plan
 * changes: a cancelled plan stays cancelled. The re-open is logged against the
 * plan with the true before → after figures.
 *
 * Returns null (after still running `write`) when the plan row is gone.
 */
async function shiftPlanPending(
  tx: DbTransaction,
  args: {
    planId: string;
    companyId: string;
    poCode: string;
    /** "short close" / "finish-close" — wording for the Plan log line. */
    how: string;
    user: AuthContext;
  },
  write: () => Promise<void>,
): Promise<PlanPendingShift | null> {
  const { planId, companyId, poCode, how, user } = args;
  const planRows = await tx
    .select({
      id: plans.id,
      code: plans.code,
      planQty: plans.planQty,
      planStatus: plans.planStatus,
    })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
    .limit(1)
    .for('update');
  const plan = planRows[0];
  if (!plan) {
    await write();
    return null;
  }
  const before = planCoverage(plan.planQty, (await readPlanOrderCoverage(tx, plan.id)).coveredQty);
  await write();
  const after = planCoverage(plan.planQty, (await readPlanOrderCoverage(tx, plan.id)).coveredQty);

  let reopened = false;
  if (after.pendingQty > 0 && plan.planStatus === 'jc_created') {
    await tx
      .update(plans)
      .set({ planStatus: 'planned' as const, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(plans.id, plan.id));
    reopened = true;
    await emitActivityLog(
      tx,
      {
        action: 'UPDATE',
        entity: 'Plan',
        detail:
          `${plan.code} re-opened by ${how} of ${poCode}: ` +
          `Pending ${before.pendingQty} → ${after.pendingQty}`,
        refId: plan.code,
      },
      companyId,
      user,
    );
  }
  // The reverse direction (a close reversal puts an order back to its full
  // Order Qty): Pending back to 0 on a plan still marked 'planned' → re-stamp
  // 'jc_created', exactly what createProductionOrder writes when a plan
  // becomes fully covered.
  if (after.pendingQty === 0 && before.pendingQty > 0 && plan.planStatus === 'planned') {
    await tx
      .update(plans)
      .set({ planStatus: 'jc_created' as const, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(plans.id, plan.id));
    await emitActivityLog(
      tx,
      {
        action: 'UPDATE',
        entity: 'Plan',
        detail:
          `${plan.code} fully covered again by ${how} of ${poCode}: ` +
          `Pending ${before.pendingQty} → ${after.pendingQty}`,
        refId: plan.code,
      },
      companyId,
      user,
    );
  }
  return {
    planCode: plan.code,
    pendingBefore: before.pendingQty,
    pendingAfter: after.pendingQty,
    reopened,
  };
}

/**
 * ADR-184 — a Job Card and every rework / repair descendant under it
 * (`parent_job_card_id` walked DOWN, depth ≤ 10, soft-deleted rows ignored),
 * as a CTE named `jc_tree` (id, depth). The mirror of jobCardOrderChainCte
 * (lib/production-order-link.ts), which walks UP.
 */
function jobCardDescendantsCte(rootJobCardId: string): SQL {
  return sql`
    WITH RECURSIVE jc_tree AS (
      SELECT jc.id, 0 AS depth
      FROM public.job_cards jc
      WHERE jc.id = ${rootJobCardId}::uuid
        AND jc.deleted_at IS NULL
      UNION ALL
      SELECT c.id, t.depth + 1
      FROM jc_tree t
      JOIN public.job_cards c ON c.parent_job_card_id = t.id
      WHERE c.deleted_at IS NULL
        AND t.depth < ${PRODUCTION_ORDER_LINK_MAX_DEPTH}
    )`;
}

/** ADR-184 — the short-close reason must say something. The shared zod schema
 *  only asks for a non-blank string (frozen contract), so the rule lives here:
 *  at least 10 characters after trim, and at least one letter (".........." or
 *  "1234567890" is not a reason). */
const SHORT_CLOSE_REASON_MIN = 10;
export function shortCloseReasonError(reason: string): string | null {
  const r = reason.trim();
  if (r.length < SHORT_CLOSE_REASON_MIN || !/\p{L}/u.test(r)) {
    return 'Give a real reason for the short close (at least 10 characters)';
  }
  return null;
}

// ─── Short close: stop the order at ANY stage (ADR-182, ADR-184) ──────────

/**
 * Stop a Production Order dead. NOT ADR-179's "close short", which finishes a
 * COMPLETE Job Card and writes off its losses — this is the abandon button, and
 * it is allowed from any stage.
 *
 * What it does (ADR-184 made the figures true):
 *   - records who stopped it, when and why (the DB CHECK makes all three
 *     mandatory; the service also refuses a reason under 10 characters or
 *     with no letters);
 *   - stores lost_qty = the pieces actually LOST on the order's Job Card
 *     (lossSql over the order's own card — see the note below), capped at
 *     order qty − credited. Pieces that were never made are NOT lost: they go
 *     back to the plan's Pending through the Covered rule;
 *   - gives the un-delivered qty back to the plan: a short-closed order covers
 *     only what it credited (lib/plan-order-coverage.ts). Credited 15 of 20 →
 *     5 go back, not 20;
 *   - puts the plan BACK to 'planned' whenever that leaves Pending > 0
 *     (shiftPlanPending), logging the re-open against the plan;
 *   - closes the order's Job Card AND every rework / repair descendant still
 *     open (closed_at = now). Nothing re-opens a short-closed order, so this
 *     is final — before ADR-184 the cards stayed open forever.
 *
 * What it deliberately does NOT do: touch the close ledger or the stock it
 * credited. Pieces that were really made and credited stay credited.
 *
 * Loss is summed over the ROOT card only, on purpose. A piece scrapped (or
 * made fresh) on a rework child is climbed up to every ancestor's rework NC
 * as failed_qty (nc-register/recovery.ts climbRecoveryToAncestors), which
 * lossSql already counts on the root; adding the child's own scrap NC too
 * would count the same piece twice.
 *
 * The only status it refuses is `short_closed` itself. A fully `closed` order
 * CAN be short closed; its Covered is already its credited qty, so nothing
 * goes back, and the loss its finish-close recorded is kept.
 */
export async function shortCloseProductionOrder(
  id: string,
  input: ShortCloseProductionOrderInput,
  user: AuthContext,
): Promise<ProductionOrderDetail> {
  await requireFormAccess(user, 'prodorder_create', 'edit');
  const companyId = requireCompany(user);

  const reason = input.reason.trim();
  const reasonError = shortCloseReasonError(reason);
  if (reasonError) throw new ValidationError(reasonError);

  return withUserContext(user, async (tx) => {
    // Lock the order so a short close and a concurrent close cannot both win.
    const locked = await tx
      .select({
        id: productionOrders.id,
        code: productionOrders.code,
        status: productionOrders.status,
        orderQty: productionOrders.orderQty,
        creditedQty: productionOrders.creditedQty,
        lostQty: productionOrders.lostQty,
        jobCardId: productionOrders.jobCardId,
        jcCodeText: productionOrders.jcCodeText,
        planId: productionOrders.planId,
        planCodeText: productionOrders.planCodeText,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const po = locked[0];
    if (!po) throw new NotFoundError(`Production Order ${id} not found`);
    if (po.status === 'short_closed') {
      throw new ConflictError(`Production Order ${po.code} is already short closed`);
    }

    const credited = po.creditedQty ?? 0;

    // ADR-184 review — finished pieces that were never credited would be
    // stranded for good: short close freezes the Job Card, caps dispatch at the
    // credited qty and gives the rest back to the plan as Pending, so a remake
    // would make them twice. Credit them first (an ordinary close), then stop.
    const finishedRows = (await tx.execute(sql`
      SELECT ${lastOpFinishedQtySql(sql`${po.jobCardId}::uuid`)} AS finished
    `)) as unknown as Array<{ finished: number | null }>;
    const finished = Math.max(0, Number(finishedRows[0]?.finished ?? 0));
    if (finished > credited) {
      throw new ConflictError(
        `${po.code}: ${finished - credited} finished piece(s) on ${po.jcCodeText ?? 'the Job Card'} are not yet credited to stock ` +
          `(${finished} finished, ${credited} credited). Close them first, then Short Close.`,
      );
    }

    const lossRows = (await tx.execute(sql`
      SELECT ROUND(${lossSql(sql`nc.job_card_id = ${po.jobCardId}::uuid`)})::int AS loss
    `)) as unknown as Array<{ loss: number | null }>;
    const ncLoss = Math.max(0, Number(lossRows[0]?.loss ?? 0));
    const lost =
      po.status === 'closed' && po.lostQty !== null
        ? po.lostQty
        : Math.min(ncLoss, Math.max(0, po.orderQty - credited));

    const now = new Date();
    const shift = await shiftPlanPending(
      tx,
      { planId: po.planId, companyId, poCode: po.code, how: 'short close', user },
      async () => {
        await tx
          .update(productionOrders)
          .set({
            status: 'short_closed',
            shortClosedAt: now,
            shortClosedBy: user.id,
            shortCloseReason: reason,
            lostQty: lost,
            updatedAt: now,
            updatedBy: user.id,
          })
          .where(eq(productionOrders.id, id));
      },
    );

    // plans.jc_id points at "the plan's Job Card" and is what the plan screen
    // links to. Re-point it at the newest LIVE order's card so it stops
    // opening the frozen one; if the stopped order was the only one, leave it
    // alone (the card still exists and is still the plan's history).
    if (shift) {
      const liveJc = (await tx.execute(sql`
        SELECT po.job_card_id AS job_card_id
        FROM public.production_orders po
        WHERE po.plan_id = ${po.planId}::uuid
          AND po.deleted_at IS NULL
          AND po.status <> 'short_closed'
        ORDER BY po.created_at DESC, po.code DESC
        LIMIT 1
      `)) as unknown as Array<{ job_card_id: string | null }>;
      const newJcId = liveJc[0]?.job_card_id ?? null;
      if (newJcId) {
        await tx
          .update(plans)
          .set({ jcId: newJcId, updatedAt: now, updatedBy: user.id })
          .where(and(eq(plans.id, po.planId), eq(plans.jcId, po.jobCardId)));
      }
    }

    // ADR-184 — the order is final, so its card and every rework / repair
    // descendant still open is closed now. One already closed keeps its time.
    const closedJcs = (await tx.execute(sql`
      ${jobCardDescendantsCte(po.jobCardId)}
      UPDATE public.job_cards j
         SET closed_at = ${now.toISOString()}::timestamptz,
             updated_at = ${now.toISOString()}::timestamptz,
             updated_by = ${user.id}::uuid
       WHERE j.id IN (SELECT jc_tree.id FROM jc_tree)
         AND j.company_id = ${companyId}::uuid
         AND j.closed_at IS NULL
      RETURNING j.code
    `)) as unknown as Array<{ code: string }>;

    const planCode = shift?.planCode ?? po.planCodeText;
    // "returned" is read off the data (Pending after − before), so the log can
    // never disagree with what the plan now shows.
    const returned = shift ? shift.pendingAfter - shift.pendingBefore : 0;
    await emitActivityLog(
      tx,
      {
        action: 'SHORT_CLOSE',
        entity: 'Production Order',
        detail:
          `${po.code} short closed — JC ${po.jcCodeText}: credited ${credited} of ${po.orderQty}, ` +
          `lost ${lost}, returned ${returned} to plan ${planCode}` +
          (shift ? ` (Pending ${shift.pendingBefore} → ${shift.pendingAfter})` : '') +
          (shift?.reopened ? ', plan re-opened for a new Production Order' : '') +
          (closedJcs.length > 0 ? `; closed JC ${closedJcs.map((r) => r.code).join(', ')}` : '') +
          `. Reason: ${reason}`,
        refId: po.code,
      },
      companyId,
      user,
    );

    return readDetailInTx(tx, id, companyId);
  });
}
