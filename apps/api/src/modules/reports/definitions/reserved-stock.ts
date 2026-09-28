// Reserved stock by SO — every stock reservation held for a sales-order line
// and (ADR-193 3c) every assembly part reservation held for an assembly SO:
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
      'Every SO stock reservation (sales and assembly parts) with Reserved, Consumed, Released and the Balance still held. Pick a Reservation Status to narrow it. Newest first.',
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
    const statusFrag = status ? sql`AND x.status = ${status}` : sql``;
    const itemFrag = item
      ? sql`AND (x.item_code ILIKE ${item} OR x.item_name ILIKE ${item}
                 OR x.item_code_text ILIKE ${item})`
      : sql``;

    // ADR-193 3c — assembly part reservations (Reservation Source "Assembly")
    // hold stock exactly like sales reservations, so they are listed too;
    // their Consumed is what Item Issues against the SO used of them.
    const result = await tx.execute(sql`
      SELECT x.* FROM (
        SELECT
          COALESCE(so.code, r.so_code_text)                   AS so_code,
          sol.client_po_line_no                               AS client_po_line_no,
          COALESCE(it.code, r.item_code_text, '—')            AS item_code,
          it.name                                             AS item_name,
          r.item_code_text                                    AS item_code_text,
          r.qty::numeric                                      AS reserved_qty,
          r.consumed_qty::numeric                             AS consumed_qty,
          r.released_qty::numeric                             AS released_qty,
          (r.qty - r.consumed_qty - r.released_qty)::numeric  AS balance_qty,
          r.status::text                                      AS status,
          r.reservation_source::text                          AS reservation_source,
          pro.code                                            AS production_order_code,
          to_char(r.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS reserved_on,
          r.created_at                                        AS created_at
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
        UNION ALL
        SELECT
          COALESCE(so.code, a.so_code_text),
          NULL,
          COALESCE(it.code, '—'),
          it.name,
          NULL,
          a.qty::numeric,
          a.consumed_qty::numeric,
          a.released_qty::numeric,
          (a.qty - a.consumed_qty - a.released_qty)::numeric,
          a.status::text,
          'Assembly',
          NULL,
          to_char(a.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'),
          a.created_at
        FROM public.assembly_part_reservations a
        LEFT JOIN public.sales_orders so
          ON so.id = a.sales_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.items it ON it.id = a.item_id AND it.deleted_at IS NULL
        WHERE a.company_id = ${companyId}::uuid
          AND a.deleted_at IS NULL
      ) x
      WHERE true
        ${statusFrag}
        ${itemFrag}
      ORDER BY x.created_at DESC
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
