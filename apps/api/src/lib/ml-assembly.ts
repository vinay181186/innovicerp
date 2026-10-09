// Multi-Level Plan assemblies downstream — ADR-225 phase 4.
//
// A Multi-Level Plan (ml_plans / ml_plan_nodes, 0203) raises ordinary Plans
// with plans.ml_plan_node_id set (0204). A node "has children" when live
// ml_plan_nodes rows name it as parent_node_id. A plan on such a node is a
// SUB-ASSEMBLY (or the top assembly): its material is its child parts, not a
// raw-material bar.
//
//   planIsMlAssembly      — the Production Order create skips the "no raw
//                           material" refusal for such a plan
//   readMlChildParts      — the child parts of a Job Card's plan node, read
//                           through JC → Production Order → Plan → node
//   childPartRequirements — pure: child parts × JC qty → requirement lines
//
// plans.ml_plan_node_id is read with raw SQL on purpose (never a Drizzle
// field), so this file does not depend on the schema.ts change.

import { sql } from 'drizzle-orm';
import { roundQty } from '@innovic/shared';
import type { DbTransaction } from '../db/with-user-context';

/** True when the plan sits on a Multi-Level Plan node that has live children. */
export async function planIsMlAssembly(
  tx: DbTransaction,
  companyId: string,
  planId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM public.plans p
      JOIN public.ml_plan_nodes c
        ON c.parent_node_id = p.ml_plan_node_id
       AND c.company_id = p.company_id
       AND c.deleted_at IS NULL
      WHERE p.id = ${planId}::uuid
        AND p.company_id = ${companyId}::uuid
        AND p.deleted_at IS NULL
        AND p.ml_plan_node_id IS NOT NULL
    ) AS has_children
  `)) as unknown as Array<{ has_children: boolean }>;
  return rows[0]?.has_children === true;
}

export interface MlChildPart {
  itemId: string;
  /** Σ qty_per_set when the same item is a child twice under one parent. */
  qtyPerSet: number;
}

/**
 * The live child parts of the plan node behind a Job Card, in tree order
 * (first seq). Empty when the card has no Production Order, the order's plan
 * is not on a Multi-Level Plan node, or the node has no live children.
 * A child with no qty_per_set is skipped (nothing to require).
 */
export async function readMlChildParts(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
): Promise<MlChildPart[]> {
  const rows = (await tx.execute(sql`
    SELECT c.item_id, SUM(c.qty_per_set) AS qps
    FROM public.job_cards jc
    JOIN public.production_orders po
      ON po.id = jc.production_order_id
     AND po.company_id = jc.company_id
     AND po.deleted_at IS NULL
    JOIN public.plans p
      ON p.id = po.plan_id
     AND p.company_id = jc.company_id
     AND p.deleted_at IS NULL
    JOIN public.ml_plan_nodes c
      ON c.parent_node_id = p.ml_plan_node_id
     AND c.company_id = jc.company_id
     AND c.deleted_at IS NULL
    WHERE jc.id = ${jobCardId}::uuid
      AND jc.company_id = ${companyId}::uuid
      AND jc.deleted_at IS NULL
      AND c.qty_per_set IS NOT NULL
    GROUP BY c.item_id
    ORDER BY MIN(c.seq)
  `)) as unknown as Array<{ item_id: string; qps: unknown }>;
  return rows.map((r) => ({ itemId: r.item_id, qtyPerSet: Number(r.qps ?? 0) }));
}

export interface Requirement {
  itemId: string;
  required: number;
}

/**
 * Pure. The card's requirement list: the RM line first (when there is one,
 * unchanged), then one line per child part, Required = qty_per_set × JC qty
 * (3 decimals). A child that is also the RM item is folded into that line,
 * so one item never has two Required figures.
 */
export function childPartRequirements(
  rm: Requirement | null,
  children: readonly MlChildPart[],
  orderQty: number,
): Requirement[] {
  const out: Requirement[] = rm ? [{ ...rm }] : [];
  for (const c of children) {
    const required = roundQty(c.qtyPerSet * orderQty);
    const same = out.find((r) => r.itemId === c.itemId);
    if (same) same.required = roundQty(same.required + required);
    else out.push({ itemId: c.itemId, required });
  }
  return out;
}
