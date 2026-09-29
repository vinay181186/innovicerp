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
//   BACK (a PO line) = Σ received qty on ORDINARY GRN lines (header nc_id
//                      NULL — a replacement receipt was counted when the
//                      pieces first came back)
//                    + Σ received qty on JW DC Inward lines made BEFORE 0172
//                      (jw_dc_inward.goods_receipt_note_id IS NULL — those
//                      receipts raised no GRN; later ones are in the GRN term)
//
// Quantities are decimal (KGS / MTR), so the sums are numeric — never ::int.
//
// The per-line conditions live in the constants below and are used by BOTH the
// scalar form (poLineSentRaw) and the grouped form (poLineSentGroupedSql), so
// the two can never disagree.

import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

const DC_SENT_FROM = `FROM public.delivery_challan_lines dcl
      JOIN public.delivery_challans dc ON dc.id = dcl.delivery_challan_id`;
const DC_SENT_WHERE = `dcl.deleted_at IS NULL AND dc.deleted_at IS NULL
        AND dc.nc_id IS NULL AND dc.status <> 'cancelled'`;
const JW_SENT_FROM = `FROM public.jw_dc_outward_lines jdol
      JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id`;
const JW_SENT_WHERE = `jdol.deleted_at IS NULL AND jdo.deleted_at IS NULL`;

/** Scalar SQL for one line's SENT; `polId` is a SQL expression for the PO line id. */
export function poLineSentRaw(polId: string): string {
  return `(COALESCE((SELECT SUM(dcl.qty)
      ${DC_SENT_FROM}
      WHERE dcl.purchase_order_line_id = ${polId}
        AND ${DC_SENT_WHERE}), 0)
    + COALESCE((SELECT SUM(jdol.sent_qty)
      ${JW_SENT_FROM}
      WHERE jdol.purchase_order_line_id = ${polId}
        AND ${JW_SENT_WHERE}), 0))`;
}

/**
 * SENT for every PO line of a company in ONE pass — a derived table with
 * columns (purchase_order_line_id, sent). Lines with nothing sent are absent.
 * Use it in list queries instead of a correlated poLineSentRaw per row.
 */
export function poLineSentGroupedSql(companyId: string): SQL {
  return sql`(
    SELECT s.purchase_order_line_id, SUM(s.qty) AS sent
    FROM (
      SELECT dcl.purchase_order_line_id, dcl.qty
      ${sql.raw(DC_SENT_FROM)}
      WHERE dcl.company_id = ${companyId}::uuid
        AND dcl.purchase_order_line_id IS NOT NULL
        AND ${sql.raw(DC_SENT_WHERE)}
      UNION ALL
      SELECT jdol.purchase_order_line_id, jdol.sent_qty
      ${sql.raw(JW_SENT_FROM)}
      WHERE jdol.company_id = ${companyId}::uuid
        AND jdol.purchase_order_line_id IS NOT NULL
        AND ${sql.raw(JW_SENT_WHERE)}
    ) s
    GROUP BY s.purchase_order_line_id
  )`;
}

/** Scalar SQL for what has come BACK on one PO line (see BACK above). */
export function poLineBackRaw(polId: string): string {
  return `(COALESCE((SELECT SUM(gl.received_qty)
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes g ON g.id = gl.goods_receipt_note_id
      WHERE gl.purchase_order_line_id = ${polId}
        AND gl.deleted_at IS NULL AND g.deleted_at IS NULL AND g.nc_id IS NULL), 0)
    + COALESCE((SELECT SUM(jdil.received_qty)
      FROM public.jw_dc_inward_lines jdil
      JOIN public.jw_dc_inward jdi ON jdi.id = jdil.jw_dc_inward_id
      JOIN public.jw_dc_outward_lines jdol ON jdol.id = jdil.jw_dc_outward_line_id
      WHERE jdol.purchase_order_line_id = ${polId}
        AND jdi.goods_receipt_note_id IS NULL
        AND jdil.deleted_at IS NULL AND jdi.deleted_at IS NULL), 0))`;
}

/**
 * Lock the PO lines about to be sent against (FOR UPDATE, in id order so two
 * challans never deadlock), BEFORE the SENT figure is read. Two challans for
 * the same line then run one after the other: the second one reads the first
 * one's lines and cannot over-send. Call it from every path that sends.
 */
export async function lockPoLinesForSend(
  tx: DbTransaction,
  poLineIds: readonly string[],
  companyId: string,
): Promise<void> {
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return;
  await tx.execute(sql`
    SELECT pol.id
    FROM public.purchase_order_lines pol
    WHERE pol.company_id = ${companyId}::uuid
      AND pol.id = ANY(${unique}::uuid[])
    ORDER BY pol.id
    FOR UPDATE
  `);
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
