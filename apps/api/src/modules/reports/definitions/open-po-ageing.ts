// Open PO ageing — POs not closed/cancelled, ordered by age ascending.
// Computes `days_open` from CURRENT_DATE - po_date so the report surfaces
// which POs are oldest (and presumably most overdue). Pattern: list with
// computed field + status enum filter.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const openPoAgeingReport: RegisteredReport = {
  definition: {
    slug: 'open-po-ageing',
    title: 'Open PO ageing',
    description:
      'POs not yet closed or cancelled, with `days_open` computed from po_date. Sorted oldest first to surface stuck procurement.',
    group: 'Procurement',
    filters: [
      {
        key: 'status',
        label: 'Status',
        kind: 'enum',
        options: ['draft', 'open', 'partial', 'qc_pending'],
      },
    ],
    columns: [
      { key: 'po_code', label: 'PO no.', type: 'text' },
      { key: 'po_date', label: 'PO date', type: 'date' },
      { key: 'days_open', label: 'Days open', type: 'number' },
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'total_qty', label: 'Total qty', type: 'number' },
      { key: 'received_qty', label: 'Received qty', type: 'number' },
      { key: 'pending_qty', label: 'Pending qty', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const statusFilter = filters['status'];
    const validStatuses = ['draft', 'open', 'partial', 'qc_pending'];
    const statusFrag =
      statusFilter && validStatuses.includes(statusFilter)
        ? sql`AND po.status = ${statusFilter}::po_status`
        : sql`AND po.status IN ('draft', 'open', 'partial', 'qc_pending')`;

    const result = await tx.execute(sql`
      SELECT
        po.code AS po_code,
        po.po_date,
        (CURRENT_DATE - po.po_date)::int AS days_open,
        v.name AS vendor_name,
        po.status,
        COALESCE(SUM(pol.qty), 0)::float AS total_qty,
        COALESCE(SUM(pol.received_qty), 0)::float AS received_qty,
        COALESCE(SUM(pol.qty - pol.received_qty), 0)::float AS pending_qty
      FROM public.purchase_orders po
      LEFT JOIN public.vendors v
        ON v.id = po.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.purchase_order_id = po.id AND pol.deleted_at IS NULL
      WHERE po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL
        ${statusFrag}
      GROUP BY po.id, v.name
      ORDER BY po.po_date ASC, po.code
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      po_code: String(r['po_code'] ?? ''),
      po_date:
        r['po_date'] instanceof Date
          ? r['po_date'].toISOString().slice(0, 10)
          : String(r['po_date'] ?? ''),
      days_open: r['days_open'] != null ? Number(r['days_open']) : 0,
      vendor_name: (r['vendor_name'] as string | null) ?? null,
      status: String(r['status'] ?? ''),
      total_qty: Number(r['total_qty'] ?? 0),
      received_qty: Number(r['received_qty'] ?? 0),
      pending_qty: Number(r['pending_qty'] ?? 0),
    }));

    return { columns: openPoAgeingReport.definition.columns, rows };
  },
};
