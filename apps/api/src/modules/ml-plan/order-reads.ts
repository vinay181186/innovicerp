// Multi-Level Plan (ADR-225 phase 4) — what has been raised from the plan's
// rows. Read by the detail (node Raised / To Raise, the Orders list), by
// Raise orders (the cap, under the plan's lock) and by Cancel (live orders
// refuse it). One definition, so the screen and the cap cannot disagree.
//
// A plan / PR belongs to a Multi-Level Plan through ml_plan_node_id → a node
// of that plan. ANY node of the plan counts (a soft-deleted node too): a
// plan raised from it is still that plan's order.
//
//   live plan = deleted_at IS NULL AND plan_status <> 'cancelled'; counts
//               plan_qty
//   live PR   = deleted_at IS NULL AND status <> 'cancelled'; counts
//               prCoverQtyRaw (lib/so-line-coverage.ts) — a balance-closed PR
//               counts only what was ordered, as the SO line coverage does

import { type SQL, sql } from 'drizzle-orm';
import type { MlPlanNode, MlPlanOrder } from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { prCoverQtyRaw } from '../../lib/so-line-coverage';
import { tsLike } from '../ml-bom/helpers';

/** What Raise orders makes from a row — the ONE rule (the detail's
 *  node.raises and orders.ts both call it): the top row and Manufacture rows
 *  → a Plan; Purchase → a PR; Outsource → a full-outsource Plan. */
export type RowRaises = MlPlanNode['raises'];
export function raisesOf(n: { depth: number; bomType: string | null }): RowRaises {
  if (n.depth === 0 || n.bomType === null || n.bomType === 'manufacture') return 'plan';
  return n.bomType === 'purchase' ? 'pr' : 'outsource_plan';
}

const LIVE_PLAN = sql`p.deleted_at IS NULL AND p.plan_status <> 'cancelled'`;
const LIVE_PR = sql`pr.deleted_at IS NULL AND pr.status <> 'cancelled'`;

/** Nodes of the plan, any state — the join every order read uses. */
const nodesOfPlan = (companyId: string, planId: string): SQL => sql`
  SELECT n.id FROM public.ml_plan_nodes n
  WHERE n.ml_plan_id = ${planId}::uuid AND n.company_id = ${companyId}::uuid`;

/**
 * Raised qty per node of the plan (thousandths as numeric(…,3) text), live
 * orders only. Nodes with nothing raised are absent. One grouped query.
 */
export async function readRaisedByNode(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<Map<string, string>> {
  const rows = (await tx.execute(sql`
    SELECT x.node_id, round(SUM(x.qty), 3)::text AS raised
    FROM (
      SELECT p.ml_plan_node_id AS node_id, p.plan_qty::numeric AS qty
      FROM public.plans p
      WHERE p.company_id = ${companyId}::uuid
        AND p.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
        AND ${LIVE_PLAN}
      UNION ALL
      SELECT pr.ml_plan_node_id AS node_id, (${sql.raw(prCoverQtyRaw('pr'))})::numeric AS qty
      FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
        AND ${LIVE_PR}
    ) x
    GROUP BY x.node_id
  `)) as unknown as Array<{ node_id: string; raised: string }>;
  return new Map(rows.map((r) => [String(r.node_id), String(r.raised)]));
}

/** Every plan / PR raised from the plan's rows, live or not, newest first. */
export async function readMlPlanOrders(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<MlPlanOrder[]> {
  const rows = (await tx.execute(sql`
    SELECT x.* FROM (
      SELECT p.ml_plan_node_id AS node_id, 'plan' AS kind, p.id AS doc_id, p.code AS doc_code,
             round(p.plan_qty::numeric, 3)::text AS qty, p.plan_status::text AS doc_status,
             (${LIVE_PLAN}) AS live, p.created_at
      FROM public.plans p
      WHERE p.company_id = ${companyId}::uuid
        AND p.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
      UNION ALL
      SELECT pr.ml_plan_node_id AS node_id, 'pr' AS kind, pr.id AS doc_id, pr.code AS doc_code,
             round(pr.qty::numeric, 3)::text AS qty, pr.status::text AS doc_status,
             (${LIVE_PR}) AS live, pr.created_at
      FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
    ) x
    ORDER BY x.created_at DESC, x.doc_code DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    nodeId: String(r['node_id']),
    kind: r['kind'] === 'pr' ? 'pr' : 'plan',
    docId: String(r['doc_id']),
    docCode: String(r['doc_code']),
    qty: String(r['qty']),
    docStatus: String(r['doc_status']),
    live: Boolean(r['live']),
    createdAt: tsLike(r['created_at']),
  }));
}

/** Codes of the LIVE orders raised from the plan (Cancel refuses on these). */
export async function readLiveOrderCodes(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT x.doc_code FROM (
      SELECT p.code AS doc_code, 1 AS k FROM public.plans p
      WHERE p.company_id = ${companyId}::uuid
        AND p.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
        AND ${LIVE_PLAN}
      UNION ALL
      SELECT pr.code AS doc_code, 2 AS k FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.ml_plan_node_id IN (${nodesOfPlan(companyId, planId)})
        AND ${LIVE_PR}
    ) x
    ORDER BY x.k, x.doc_code
  `)) as unknown as Array<{ doc_code: string }>;
  return rows.map((r) => String(r.doc_code));
}

/**
 * Raised on ONE node, leaving out one document (the plan / PR being edited),
 * so an edit can be capped at Net Need − everything else raised.
 */
export async function readRaisedOnNodeExcluding(
  tx: DbTransaction,
  companyId: string,
  nodeId: string,
  exclude: { kind: 'plan' | 'pr'; id: string },
): Promise<string> {
  const notPlan = exclude.kind === 'plan' ? sql`AND p.id <> ${exclude.id}::uuid` : sql``;
  const notPr = exclude.kind === 'pr' ? sql`AND pr.id <> ${exclude.id}::uuid` : sql``;
  const rows = (await tx.execute(sql`
    SELECT round(COALESCE(SUM(x.qty), 0), 3)::text AS raised
    FROM (
      SELECT p.plan_qty::numeric AS qty FROM public.plans p
      WHERE p.company_id = ${companyId}::uuid AND p.ml_plan_node_id = ${nodeId}::uuid
        AND ${LIVE_PLAN} ${notPlan}
      UNION ALL
      SELECT (${sql.raw(prCoverQtyRaw('pr'))})::numeric AS qty FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid AND pr.ml_plan_node_id = ${nodeId}::uuid
        AND ${LIVE_PR} ${notPr}
    ) x
  `)) as unknown as Array<{ raised: string }>;
  return String(rows[0]?.raised ?? '0');
}
