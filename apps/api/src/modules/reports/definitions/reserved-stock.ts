// Reserved stock by SO — every stock reservation held for a sales-order line:
// how much was booked, shipped (consumed), given back (released) and is still
// held, with where it came from (a Production Order close or a manual booking).
// Modelled on ERPNext's "Reserved Stock" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell as dateOrNull, enumFilter, likeFilter } from './report-helpers';

const RESERVATION_STATUSES = [
  'active',
  'partially_consumed',
  'consumed',
  'released',
  'cancelled',
  'dispatched',
];

export const reservedStockReport: RegisteredReport = {
  definition: {
    slug: 'reserved-stock',
    title: 'Reserved stock by SO',
    description:
      'Every SO stock reservation with Reserved, Consumed, Released and the Balance still held. Pick a Reservation Status to narrow it. Newest first.',
    group: 'Store',
    dept: 'store',
    filters: [
      {
        key: 'status',
        label: 'Reservation Status',
        kind: 'enum',
        options: RESERVATION_STATUSES,
      },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
    ],
    columns: [
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'reserved_qty', label: 'Reserved', type: 'number' },
      { key: 'consumed_qty', label: 'Consumed', type: 'number' },
      { key: 'released_qty', label: 'Released', type: 'number' },
      { key: 'balance_qty', label: 'Balance Reserved', type: 'number' },
      { key: 'status', label: 'Reservation Status', type: 'text' },
      { key: 'reservation_source', label: 'Reservation Source', type: 'text' },
      { key: 'production_order_code', label: 'Production Order No.', type: 'text' },
      { key: 'reserved_on', label: 'Reserved On', type: 'date' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const status = enumFilter(filters['status'], RESERVATION_STATUSES);
    const item = likeFilter(filters['item']);
    const statusFrag = status ? sql`AND r.status = ${status}` : sql``;
    const itemFrag = item
      ? sql`AND (it.code ILIKE ${item} OR it.name ILIKE ${item}
                 OR r.item_code_text ILIKE ${item})`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        COALESCE(so.code, r.so_code_text)                   AS so_code,
        sol.client_po_line_no                               AS client_po_line_no,
        COALESCE(it.code, r.item_code_text, '—')            AS item_code,
        it.name                                             AS item_name,
        r.qty                                               AS reserved_qty,
        r.consumed_qty                                      AS consumed_qty,
        r.released_qty                                      AS released_qty,
        (r.qty - r.consumed_qty - r.released_qty)::int      AS balance_qty,
        r.status                                            AS status,
        r.reservation_source                                AS reservation_source,
        pro.code                                            AS production_order_code,
        to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS reserved_on
      FROM public.so_stock_reservations r
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = r.so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.items it ON it.id = r.item_id AND it.deleted_at IS NULL
      LEFT JOIN public.production_orders pro
        ON pro.id = r.production_order_id AND pro.deleted_at IS NULL
      WHERE r.company_id = ${companyId}::uuid
        AND r.deleted_at IS NULL
        ${statusFrag}
        ${itemFrag}
      ORDER BY r.created_at DESC
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      so_code: (r['so_code'] as string | null) ?? null,
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? null,
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      reserved_qty: Number(r['reserved_qty'] ?? 0),
      consumed_qty: Number(r['consumed_qty'] ?? 0),
      released_qty: Number(r['released_qty'] ?? 0),
      balance_qty: Number(r['balance_qty'] ?? 0),
      status: String(r['status'] ?? ''),
      reservation_source: String(r['reservation_source'] ?? ''),
      production_order_code: (r['production_order_code'] as string | null) ?? null,
      reserved_on: dateOrNull(r['reserved_on']),
    }));

    return { columns: reservedStockReport.definition.columns, rows };
  },
};
