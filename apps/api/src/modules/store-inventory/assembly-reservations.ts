// Store "where is this stock reserved?" drill-down — the assembly half
// (ADR-193 3c). Parts held for an assembly SO sit in assembly_part_reservations,
// not so_stock_reservations; listReservations appends these rows.
import type { ListReservationsQuery, ReservationDetail } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

/** Assembly part reservations as drill-down rows (no SO line; decimals allowed). */
export async function readAssemblyReservationRows(
  tx: DbTransaction,
  companyId: string,
  query: ListReservationsQuery,
): Promise<ReservationDetail[]> {
  const rows = (await tx.execute(sql`
    SELECT r.id, r.item_id, COALESCE(i.code, '') AS item_code, r.so_code_text, r.sales_order_id,
           so.internal_so_no AS so_internal_no,
           COALESCE(c.name, so.customer_name) AS customer_name,
           r.qty::float8 AS qty, r.consumed_qty::float8 AS consumed_qty,
           r.released_qty::float8 AS released_qty, r.status, r.release_reason,
           r.created_at, u.full_name AS reserved_by_name
    FROM public.assembly_part_reservations r
    LEFT JOIN public.items i ON i.id = r.item_id AND i.company_id = r.company_id
    LEFT JOIN public.sales_orders so ON so.id = r.sales_order_id AND so.company_id = r.company_id
    LEFT JOIN public.clients c ON c.id = so.client_id
    LEFT JOIN public.users u ON u.id = r.created_by
    WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
      ${query.includeClosed ? sql`` : sql`AND r.status IN ('active', 'partially_consumed')`}
      ${query.itemId ? sql`AND r.item_id = ${query.itemId}::uuid` : sql``}
      ${query.salesOrderId ? sql`AND r.sales_order_id = ${query.salesOrderId}::uuid` : sql``}
    ORDER BY r.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const qty = Number(r['qty']);
    const consumedQty = Number(r['consumed_qty']);
    const releasedQty = Number(r['released_qty']);
    return {
      id: String(r['id']),
      itemId: String(r['item_id']),
      itemCode: (r['item_code'] as string | null) || null,
      soLineId: null,
      soCodeText: String(r['so_code_text'] ?? ''),
      soInternalNo: (r['so_internal_no'] as string | null) ?? null,
      lineNo: null,
      customerName: (r['customer_name'] as string | null) ?? null,
      itemRevision: null,
      clientPoLineNo: null,
      qty,
      consumedQty,
      releasedQty,
      remainingQty: Math.max(0, Math.round((qty - consumedQty - releasedQty) * 1000) / 1000),
      source: 'assembly',
      status: String(r['status']) as ReservationDetail['status'],
      productionOrderId: null,
      productionOrderCode: null,
      jobCardId: null,
      jobCardCode: null,
      salesOrderId: (r['sales_order_id'] as string | null) ?? null,
      reservedAt: new Date(String(r['created_at'])).toISOString(),
      reservedByName: (r['reserved_by_name'] as string | null) ?? null,
      remarks: (r['release_reason'] as string | null) ?? null,
    };
  });
}
