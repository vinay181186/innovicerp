// Per-op "accepted back from the vendor" qty for the pure calc-engine.
//
// G9c (docs/audits/2026-09-16-osp-chain-gap-report.md): SO Status and SO
// Overview build their op rollups from op_log only, so an outsource op never
// read complete there even when Incoming QC had accepted 10/10 off the GRN,
// and at_vendor stayed at the full input. This loader is the one query that
// feeds enrichOps its optional `ospAcceptedByOp` map.
//
// Same rollup rule as v_jc_op_status (0128) widened to the multi-PO link table
// (jc_op_po_lines): an op's PO lines come from the ONE shared link
// (ospOpPoLinkSql, lib/so-line-osp-cover.ts — ADR-320) in its two-way form:
// outsource_po_line_id ∪ live jc_op_po_lines, UNION so a line reached two ways is
// summed once — the SAME set v_jc_op_status (0128) uses, so SO Status / SO
// Overview and the Job Card screens agree on when an op is done. (SO Status PO
// cover also follows source_jc_op_id; that only widens PO cover, never "done".)
// Then Σ goods_receipt_note_lines.qc_accepted_qty over
// live GRN lines on those PO lines.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ospOpPoLinkSql } from './so-line-osp-cover';

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
           COALESCE(SUM(grl.qc_accepted_qty), 0)::numeric AS "acceptedQty"
    FROM (${ospOpPoLinkSql(companyId, jobCardIds, { includeSourceJcOp: false })}) l
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
