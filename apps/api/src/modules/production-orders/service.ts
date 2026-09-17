// Production Orders service (ADR-170, migration 0133).
//
// A Production Order (IN-PRO-#####) is the ONE document that turns a
// route-card-driven plan into a Job Card:
//
//   Plan (qty / dates / raw material)  +  Route Card (the item's operations)
//   +  Target Date   ──create──▶   Job Card   … the existing JC flow …
//   ──close (only once the JC is complete)──▶  stock credited ONCE with the
//   Job Card's actually finished qty (48 of a 50 plan credits 48).
//
// Close guard and scrap (TEST run 2026-09-17, flow-po.spec.ts S1-d,
// IN-PRO-00001 / IN-JC-26-00055): v_jc_op_status marks an op `complete` only
// when its output reaches the FULL order qty and never subtracts scrapped
// pieces, so 50 ordered → 2 scrapped at DIR → 48 finished left the JC 'open'
// for good and Close disabled. The guard therefore also accepts a JC that is
// "settled with losses" (JC_SETTLED_WITH_SCRAP_SQL below): every op has
// nothing left to do, no NC or rework child is open, and finished + scrapped
// >= order qty. Scrapped pieces are subtracted for the close guard ONLY — the
// views are unchanged and the credited qty is still the last op's finished
// qty (48), never the plan.
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
  productionOrders,
  routeCardOps,
  routeCards,
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
import { closeBlockedReason } from '../../lib/production-order-close-guard';
import { emitActivityLog } from '../activity-log/service';
import { buildJobCardFromOps, type JcBuildOp } from '../plans/service';
import type {
  CloseProductionOrderInput,
  CreateProductionOrderInput,
  ListProductionOrdersQuery,
  ListProductionOrdersResponse,
  NextProductionOrderCodeResponse,
  ProductionOrderDetail,
  ProductionOrderListItem,
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

/** Output of the JC's LAST live op — the SAME expression job-cards/service.ts
 *  uses for `lastOpCompletedQty`: qc_accepted_qty for a QC / qc_required op,
 *  completed_qty otherwise. This is the number Close credits. */
const JC_FINISHED_QTY_SQL = sql<number>`COALESCE((
  SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
              THEN vos.qc_accepted_qty ELSE vos.completed_qty END
  FROM public.v_jc_op_status vos
  WHERE vos.job_card_id = ${productionOrders.jobCardId}
  ORDER BY vos.op_seq DESC LIMIT 1
), 0)::int`;

/** "Settled with losses" — true when the JC cannot reach v_jc_status
 *  'complete' only because pieces were scrapped along the route, yet nothing
 *  is left to do anywhere. All four legs must hold (TEST run 2026-09-17,
 *  flow-po.spec.ts S1-d: 50 → DIR 48/2, NC scrap 2 → Milling 48 → FI 48):
 *   1. no op still has work — v_jc_op_status: computed_status <> 'running';
 *      available (net of pieces scrapped on that very op) = 0 on every non-QC
 *      op; qc_pending = 0 on every QC / qc_required op; nothing at the vendor,
 *      in Incoming QC or owed to rework;
 *   2. no open NC on any op — v_nc_op_breakup: Σ nc_open_qty = Σ open_nc_count = 0;
 *   3. no open rework / repair child JC (parent_job_card_id = this JC) —
 *      v_jc_status of the child must be 'complete' or 'closed';
 *   4. the pieces are accounted for — last-op finished qty (the SAME
 *      expression as JC_FINISHED_QTY_SQL) + Σ scrap_qty >= order_qty, AND
 *      Σ scrap_qty > 0 so the ordinary 'complete' path is untouched when
 *      nothing was scrapped.
 *  Views only, nothing stored; keyed off the PO's job_card_id like the two
 *  expressions above. */
const JC_SETTLED_WITH_SCRAP_SQL = sql<boolean>`COALESCE((
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.v_jc_op_status vos
      WHERE vos.job_card_id = jc.id
        AND (
          vos.computed_status = 'running'
          -- available on an outsource op still counts the vendor-rejected
          -- pieces (input − accepted − open RTV), so a piece scrapped there
          -- would hold the op open forever; net this op's own scrap out.
          OR (vos.op_type <> 'qc'
              AND vos.available - COALESCE((
                SELECT SUM(b.scrap_qty) FROM public.v_nc_op_breakup b
                WHERE b.jc_op_id = vos.jc_op_id
              ), 0) > 0)
          OR ((vos.op_type = 'qc' OR vos.qc_required) AND vos.qc_pending <> 0)
          OR vos.at_vendor_qty <> 0
          OR vos.in_qc_qty <> 0
          OR vos.rework_pending_qty <> 0
        )
    )
    AND COALESCE((
      SELECT SUM(b.nc_open_qty) + SUM(b.open_nc_count)
      FROM public.v_nc_op_breakup b
      WHERE b.job_card_id = jc.id
    ), 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.job_cards child
      JOIN public.v_jc_status cs ON cs.job_card_id = child.id
      WHERE child.parent_job_card_id = jc.id
        AND child.deleted_at IS NULL
        AND cs.computed_status NOT IN ('complete', 'closed')
    )
    AND COALESCE((
      SELECT SUM(b.scrap_qty) FROM public.v_nc_op_breakup b
      WHERE b.job_card_id = jc.id
    ), 0) > 0
    AND COALESCE((
      SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                  THEN vos.qc_accepted_qty ELSE vos.completed_qty END
      FROM public.v_jc_op_status vos
      WHERE vos.job_card_id = jc.id
      ORDER BY vos.op_seq DESC LIMIT 1
    ), 0)
    + COALESCE((
      SELECT SUM(b.scrap_qty) FROM public.v_nc_op_breakup b
      WHERE b.job_card_id = jc.id
    ), 0) >= jc.order_qty
  FROM public.job_cards jc
  WHERE jc.id = ${productionOrders.jobCardId}
    AND jc.deleted_at IS NULL
), false)`;

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

const createdByUser = alias(users, 'po_created_by');
const closedByUser = alias(users, 'po_closed_by');

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
  closedAt: productionOrders.closedAt,
  closedBy: productionOrders.closedBy,
  creditedQty: productionOrders.creditedQty,
  remarks: productionOrders.remarks,
  createdAt: productionOrders.createdAt,
  createdBy: productionOrders.createdBy,
  updatedAt: productionOrders.updatedAt,
  updatedBy: productionOrders.updatedBy,
  deletedAt: productionOrders.deletedAt,
  // live joins
  jcComputedStatus: JC_COMPUTED_STATUS_SQL,
  jcFinishedQty: JC_FINISHED_QTY_SQL,
  // Close-guard input only (ADR-170 scrap case). NOT part of the shared
  // contract: toListItem never copies it and the list payload never carries it;
  // it is folded into canClose / closeBlockedReason on the detail.
  jcSettledWithScrap: JC_SETTLED_WITH_SCRAP_SQL,
  jcClosedAt: jobCards.closedAt,
  jcExists: jobCards.id,
  partyName: PARTY_NAME_SQL,
  createdByName: createdByUser.fullName,
  closedByName: closedByUser.fullName,
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
    routeCardId: r.routeCardId,
    routeCardCodeText: r.routeCardCodeText,
    routeCardRevision: r.routeCardRevision,
    jobCardId: r.jobCardId,
    jcCodeText: r.jcCodeText,
    orderQty: r.orderQty,
    targetDate: dateOnly(r.targetDate),
    closedAt: toIso(r.closedAt),
    closedBy: r.closedBy,
    creditedQty: r.creditedQty,
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
    createdByName: r.createdByName ?? null,
    closedByName: r.closedByName ?? null,
  };
}

/** The "may this be closed?" sentence lives in lib/production-order-close-guard.ts
 *  (pure, unit-tested). The detail view shows it as `closeBlockedReason`; Close
 *  throws exactly the same words, so what the screen says and what the server
 *  refuses can never differ. `jcSettledWithScrap` is read off the row here and
 *  folded in — it never travels to the browser. */
function toDetail(
  item: ProductionOrderListItem,
  jcSettledWithScrap: boolean,
): ProductionOrderDetail {
  const reason = closeBlockedReason({ ...item, jcSettledWithScrap });
  return { ...item, canClose: reason === null, closeBlockedReason: reason };
}

function baseQuery(tx: DbTransaction) {
  return tx
    .select(poColumns)
    .from(productionOrders)
    .leftJoin(jobCards, eq(jobCards.id, productionOrders.jobCardId))
    .leftJoin(createdByUser, eq(createdByUser.id, productionOrders.createdBy))
    .leftJoin(closedByUser, eq(closedByUser.id, productionOrders.closedBy));
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
  return toDetail(toListItem(row as PoRow), row.jcSettledWithScrap === true);
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

  // withUniqueRetry: two users creating orders for DIFFERENT plans at the same
  // moment can both compute the same next IN-PRO-##### — the loser's whole
  // transaction (JC, ops, OSP PRs) rolls back and re-runs with the next number.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      // Row-lock the plan: two clicks on Create must not both read "no order
      // yet" and each build a Job Card. The second waits, re-reads, and is
      // refused by the checks below (the partial unique index on plan_id is the
      // last line of defence).
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
      if (plan.planStatus !== 'planned') {
        throw new ValidationError(
          `Plan ${plan.code} is '${plan.planStatus}' — only a planned plan can be turned into a Production Order`,
        );
      }
      const existingPo = await tx
        .select({ code: productionOrders.code })
        .from(productionOrders)
        .where(and(eq(productionOrders.planId, plan.id), isNull(productionOrders.deletedAt)))
        .limit(1);
      if (existingPo[0]) {
        throw new ConflictError(
          `Plan ${plan.code} already has Production Order ${existingPo[0].code} — one order per plan`,
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
        .set({ planType: rc.planType, updatedBy: user.id })
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
      });
      const jc = built.jc;

      await tx
        .update(plans)
        .set({ planStatus: 'jc_created', jcId: jc.id, updatedBy: user.id })
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
          orderQty: plan.planQty,
          targetDate: input.targetDate,
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
            built.raisedPrCodes.length > 0
              ? `${code} — ${plan.code} + ${rc.code} (Rev ${rc.currentRevision}) → JC ${jc.code}, ${ops.length} ops + OSP PR ${built.raisedPrCodes.join(', ')}`
              : `${code} — ${plan.code} + ${rc.code} (Rev ${rc.currentRevision}) → JC ${jc.code}, ${ops.length} ops`,
          refId: code,
        },
        companyId,
        user,
      );

      return readDetailInTx(tx, po.id, companyId);
    }),
  );
}

// ─── Close: credit stock ONCE with the JC's finished qty ───────────────────

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
      .select({ id: productionOrders.id, status: productionOrders.status })
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
    if (locked[0].status !== 'open') {
      throw new ConflictError('Production Order is already closed');
    }

    // Live progress, read AFTER the lock so the number credited is the one
    // that exists at this instant.
    const current = await readDetailInTx(tx, id, companyId);
    // Same sentence the detail view shows (closeBlockedReason ran in toDetail).
    if (current.closeBlockedReason) throw new ValidationError(current.closeBlockedReason);
    const qty = current.jcFinishedQty;

    // ONE stock row for the whole order. Same columns as the qc_accept credit
    // in op-entry/qc-stock-cascade.ts; the items row is locked first to
    // serialise concurrent stock writes on the same item, and the before/after
    // balance is read from v_item_stock so the ledger stays a running total.
    const today = new Date().toISOString().slice(0, 10);
    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${current.itemId}::uuid FOR UPDATE`);
    const balanceRows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${current.itemId}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const stockBefore = Number(balanceRows[0]?.on_hand ?? 0);
    const stockAfter = stockBefore + qty;

    await tx.insert(storeTransactions).values({
      companyId,
      txnDate: today,
      itemId: current.itemId,
      txnType: 'in',
      qty,
      sourceType: 'production_order_close',
      sourceRef: current.code,
      stockBefore,
      stockAfter,
      remarks: `Production Order ${current.code} closed — JC ${current.jcCodeText} finished ${qty} of ${current.orderQty}`,
      createdBy: user.id,
    });

    const now = new Date();
    await tx
      .update(productionOrders)
      .set({
        status: 'closed',
        closedAt: now,
        closedBy: user.id,
        creditedQty: qty,
        ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(productionOrders.id, id));

    // A complete-but-not-closed JC is closed with its order. One already
    // closed (by the sales cascade) keeps its original close time.
    if (current.jcClosedAt === null) {
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
        detail: `${current.code} closed — JC ${current.jcCodeText} finished ${qty} of ${current.orderQty}, stock credited ${qty}`,
        refId: current.code,
      },
      companyId,
      user,
    );

    return readDetailInTx(tx, id, companyId);
  });
}
