// Vendor PO summary — aggregate POs by vendor: count, total value, total
// pending value. Pattern: aggregate by dimension (vendor) with optional
// date-range filter. Useful to surface concentration risk + open exposure
// per vendor.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const vendorPoSummaryReport: RegisteredReport = {
  definition: {
    slug: 'vendor-po-summary',
    title: 'Vendor PO summary',
    description:
      'Per-vendor counts + total value + open value across POs. Filter by PO date window. Sorted by total value descending so top suppliers surface first.',
    group: 'Procurement',
    filters: [
      { key: 'fromDate', label: 'PO from', kind: 'date' },
      { key: 'toDate', label: 'PO to', kind: 'date' },
    ],
    columns: [
      { key: 'vendor_code', label: 'Vendor code', type: 'text' },
      { key: 'vendor_name', label: 'Vendor name', type: 'text' },
      { key: 'po_count', label: 'PO count', type: 'number' },
      { key: 'open_count', label: 'Open / partial', type: 'number' },
      { key: 'closed_count', label: 'Closed', type: 'number' },
      { key: 'total_value', label: 'Total value', type: 'number' },
      { key: 'pending_value', label: 'Pending value', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = filters['fromDate'];
    const toDate = filters['toDate'];
    const fromFrag = fromDate ? sql`AND po.po_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND po.po_date <= ${toDate}::date` : sql``;

    const result = await tx.execute(sql`
      WITH po_lines AS (
        SELECT
          po.id,
          po.vendor_id,
          po.vendor_code_text,
          po.status,
          COALESCE(SUM(pol.qty * pol.rate), 0)::numeric(14, 2) AS line_total,
          COALESCE(SUM((pol.qty - pol.received_qty) * pol.rate), 0)::numeric(14, 2)
            AS line_pending
        FROM public.purchase_orders po
        LEFT JOIN public.purchase_order_lines pol
          ON pol.purchase_order_id = po.id AND pol.deleted_at IS NULL
        WHERE po.company_id = ${companyId}::uuid
          AND po.deleted_at IS NULL
          ${fromFrag}
          ${toFrag}
        GROUP BY po.id
      )
      SELECT
        COALESCE(v.code, pl.vendor_code_text, '—') AS vendor_code,
        COALESCE(v.name, pl.vendor_code_text, '—') AS vendor_name,
        COUNT(*)::int                              AS po_count,
        COUNT(*) FILTER (WHERE pl.status IN ('draft', 'open', 'partial', 'qc_pending'))::int
                                                   AS open_count,
        COUNT(*) FILTER (WHERE pl.status = 'closed')::int
                                                   AS closed_count,
        COALESCE(SUM(pl.line_total), 0)::numeric(14, 2)   AS total_value,
        COALESCE(SUM(pl.line_pending), 0)::numeric(14, 2) AS pending_value
      FROM po_lines pl
      LEFT JOIN public.vendors v ON v.id = pl.vendor_id AND v.deleted_at IS NULL
      GROUP BY v.code, v.name, pl.vendor_code_text
      ORDER BY total_value DESC, vendor_name ASC
      LIMIT 500
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      vendor_code: String(r['vendor_code'] ?? ''),
      vendor_name: String(r['vendor_name'] ?? ''),
      po_count: Number(r['po_count'] ?? 0),
      open_count: Number(r['open_count'] ?? 0),
      closed_count: Number(r['closed_count'] ?? 0),
      total_value: Number(r['total_value'] ?? 0),
      pending_value: Number(r['pending_value'] ?? 0),
    }));

    return { columns: vendorPoSummaryReport.definition.columns, rows };
  },
};
