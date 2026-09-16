// Per-op "accepted back from the vendor" qty for the pure calc-engine.
//
// G9c (docs/audits/2026-09-16-osp-chain-gap-report.md): SO Status and SO
// Overview build their op rollups from op_log only, so an outsource op never
// read complete there even when Incoming QC had accepted 10/10 off the GRN,
// and at_vendor stayed at the full input. This loader is the one query that
// feeds enrichOps its optional `ospAcceptedByOp` map.
//
// Same rollup rule as v_jc_op_status (0128) widened to the multi-PO link table
// (jc_op_po_lines): an op's PO lines are its `outsource_po_line_id` UNION every
// live jc_op_po_lines row for it — UNION (not UNION ALL) so a line present in
// both is summed once. Then Σ goods_receipt_note_lines.qc_accepted_qty over
// live GRN lines on those PO lines.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** Σ GRN qc_accepted_qty keyed by jc_ops.id, for every op on the given job
 *  cards that has at least one PO line. Ops with nothing accepted are absent
 *  (read with `?? 0`). Empty input → empty map, no query. */
export async function loadOspAcceptedByOp(
  tx: DbTransaction,
  companyId: string,
  jobCardIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (jobCardIds.length === 0) return out;
  const rows = await tx.execute(sql`
    SELECT l.jc_op_id AS "jcOpId",
           COALESCE(SUM(grl.qc_accepted_qty), 0)::int AS "acceptedQty"
    FROM (
      SELECT o.id AS jc_op_id, o.outsource_po_line_id AS po_line_id
      FROM public.jc_ops o
      WHERE o.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${sql.join(
          jobCardIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        AND o.deleted_at IS NULL
        AND o.outsource_po_line_id IS NOT NULL
      UNION
      SELECT jl.jc_op_id, jl.purchase_order_line_id
      FROM public.jc_op_po_lines jl
      JOIN public.jc_ops o ON o.id = jl.jc_op_id AND o.deleted_at IS NULL
      WHERE jl.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${sql.join(
          jobCardIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        AND jl.deleted_at IS NULL
    ) l
    JOIN public.goods_receipt_note_lines grl
      ON grl.purchase_order_line_id = l.po_line_id
      AND grl.deleted_at IS NULL
    JOIN public.goods_receipt_notes grn
      ON grn.id = grl.goods_receipt_note_id
      AND grn.deleted_at IS NULL
    GROUP BY l.jc_op_id
  `);
  for (const r of rows as unknown as Array<{ jcOpId: string; acceptedQty: number | string }>) {
    out.set(r.jcOpId, Number(r.acceptedQty ?? 0));
  }
  return out;
}
