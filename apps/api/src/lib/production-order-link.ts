// Production Order link — the stock OFF switch (ADR-170).
//
// A Job Card built by a Production Order (`job_cards.production_order_id` set)
// is credited to stock exactly ONCE: when the user closes that Production
// Order, with the JC's actually finished qty. So every other place that used
// to credit finished goods for a JC — the last op's QC accept
// (op-entry/qc-stock-cascade.ts), an OSP GRN's Incoming QC
// (goods-receipt-notes/cascades.ts creditGrnQcStock) and the Incoming-QC
// mirror onto a terminal QC op (incoming-qc/service.ts, which goes through
// the same qc-stock-cascade) — must first ask this helper and write nothing
// when it says the JC is PO-linked.
//
// Rework / repair children: a child JC (parent_job_card_id set) never carries
// production_order_id itself, but its cleared pieces re-enter the PARENT's
// origin op and are counted in the parent's finished qty. So the child of a
// PO-linked parent credits nothing either — hence the walk up the
// parent_job_card_id chain. Depth is capped at 10: real chains are one or
// two deep, and the cap keeps a cyclic link (which the schema does not
// forbid) from spinning forever.
//
// Old JCs (no PO anywhere in their ancestry) get `false` and behave exactly
// as before.

import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** Maximum number of parent hops walked up from the given JC (the JC itself
 *  is depth 0, so at most 11 rows are ever visited). */
export const PRODUCTION_ORDER_LINK_MAX_DEPTH = 10;

/**
 * The recursive walk itself, as a reusable CTE named `chain`
 * (id, parent_job_card_id, production_order_id, depth). The caller appends its
 * own SELECT over `chain`.
 *
 * Shared so the ADR-170 stock OFF switch below and the ADR-182 short-close
 * guard (lib/production-order-stop.ts) can never disagree about which orders a
 * Job Card belongs to: same hops, same depth cap, same soft-delete filter.
 */
export function jobCardOrderChainCte(jobCardId: string): SQL {
  return sql`
    WITH RECURSIVE chain AS (
      SELECT jc.id, jc.parent_job_card_id, jc.production_order_id, 0 AS depth
      FROM public.job_cards jc
      WHERE jc.id = ${jobCardId}::uuid
        AND jc.deleted_at IS NULL
      UNION ALL
      SELECT p.id, p.parent_job_card_id, p.production_order_id, c.depth + 1
      FROM chain c
      JOIN public.job_cards p ON p.id = c.parent_job_card_id
      WHERE p.deleted_at IS NULL
        AND c.depth < ${PRODUCTION_ORDER_LINK_MAX_DEPTH}
    )`;
}

/**
 * True when the Job Card — or any ancestor reached through
 * `parent_job_card_id` (recursive, depth ≤ 10, soft-deleted rows ignored) —
 * has `production_order_id` set.
 *
 * ADR-170 — a PO-linked JC is credited only at PO close; its rework/repair
 * children credit nothing because their cleared pieces re-enter the parent's
 * origin op and are counted in the parent's finished qty.
 */
export async function isProductionOrderLinkedJc(
  tx: DbTransaction,
  jobCardId: string,
): Promise<boolean> {
  const rows = (await tx.execute(sql`
    ${jobCardOrderChainCte(jobCardId)}
    SELECT EXISTS (
      SELECT 1 FROM chain WHERE chain.production_order_id IS NOT NULL
    ) AS linked
  `)) as unknown as Array<{ linked: boolean }>;
  return rows[0]?.linked === true;
}
