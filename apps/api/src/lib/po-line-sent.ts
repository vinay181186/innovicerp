// SENT against a PO line — the ONE figure (high-findings fix, jw-dc-outward#1).
//
// Material can leave the shop against a Job Work / Service PO line on two
// documents: the OSP Delivery Challan (delivery_challan_lines) and the JW DC
// Outward (jw_dc_outward_lines). Each screen used to count only its own table,
// so a 10-pc PO line could go 10 on each = 20 out. Both screens now read this
// one sum, so what one challan sends the other can no longer send again.
//
//   SENT (a PO line) = Σ OSP DC line qty  (not deleted, challan not cancelled,
//                                          not a return-to-vendor challan —
//                                          nc_id set; those pieces were
//                                          counted when they first went out)
//                    + Σ JW DC Outward line sent qty (not deleted)
//
// Quantities are decimal (KGS / MTR), so the sum is numeric — never ::int.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

/** Scalar SQL for one line's SENT; `polId` is a SQL expression for the PO line id. */
export function poLineSentRaw(polId: string): string {
  return `(COALESCE((SELECT SUM(dcl.qty)
      FROM public.delivery_challan_lines dcl
      JOIN public.delivery_challans dc ON dc.id = dcl.delivery_challan_id
      WHERE dcl.purchase_order_line_id = ${polId}
        AND dcl.deleted_at IS NULL AND dc.deleted_at IS NULL
        AND dc.nc_id IS NULL AND dc.status <> 'cancelled'), 0)
    + COALESCE((SELECT SUM(jdol.sent_qty)
      FROM public.jw_dc_outward_lines jdol
      JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id
      WHERE jdol.purchase_order_line_id = ${polId}
        AND jdol.deleted_at IS NULL AND jdo.deleted_at IS NULL), 0))`;
}

/** SENT per PO line, for the given lines (missing = nothing sent yet). */
export async function sumSentOnPoLines(
  tx: DbTransaction,
  poLineIds: readonly string[],
  companyId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT pol.id AS "poLineId", ${sql.raw(poLineSentRaw('pol.id'))}::float8 AS "sent"
    FROM public.purchase_order_lines pol
    WHERE pol.company_id = ${companyId}::uuid
      AND pol.id = ANY(${unique}::uuid[])
  `)) as unknown as Array<{ poLineId: string; sent: number | string | null }>;
  for (const r of rows) {
    const sent = Number(r.sent ?? 0);
    if (sent > 0) out.set(r.poLineId, sent);
  }
  return out;
}
