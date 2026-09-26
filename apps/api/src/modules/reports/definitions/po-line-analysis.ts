// PO line analysis — one row per purchase-order line: what was ordered, what
// the GRNs received, what Incoming QC accepted / rejected, what is still
// Pending (0 once the PO is closed, cancelled or short-closed — ADR-189) and
// how late it is. Modelled on ERPNext's "Purchase Order Analysis" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell as dateOrNull, enumFilter, isoDateFilter, likeFilter } from './report-helpers';

const PO_TYPES = ['standard', 'job_work', 'outsource', 'service'];
const PO_STATUSES = ['draft', 'open', 'partial', 'qc_pending', 'closed', 'cancelled'];

export const poLineAnalysisReport: RegisteredReport = {
  definition: {
    slug: 'po-line-analysis',
    title: 'PO line analysis',
    description:
      'Every PO line with Qty, Received, Incoming QC Accepted / Rejected, Pending, Pending Value and Days Late. Draft and cancelled POs are left out unless picked in PO Status. A short-closed or closed PO has nothing Pending.',
    group: 'Purchase',
    dept: 'purchase',
    showsMoney: true,
    filters: [
      { key: 'fromDate', label: 'PO Date From', kind: 'date' },
      { key: 'toDate', label: 'PO Date To', kind: 'date' },
      { key: 'vendor', label: 'Vendor', kind: 'text', placeholder: 'Vendor name or code' },
      { key: 'poType', label: 'PO Type', kind: 'enum', options: PO_TYPES },
      { key: 'status', label: 'PO Status', kind: 'enum', options: PO_STATUSES },
      { key: 'onlyPending', label: 'Only Pending', kind: 'enum', options: ['yes', 'no'] },
    ],
    columns: [
      { key: 'po_code', label: 'PO No.', type: 'text' },
      { key: 'po_date', label: 'PO Date', type: 'date' },
      { key: 'po_type', label: 'PO Type', type: 'text' },
      { key: 'po_status', label: 'PO Status', type: 'text' },
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'line_no', label: 'Ln', type: 'number' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'received_qty', label: 'Received', type: 'number' },
      { key: 'qc_accepted_qty', label: 'Accepted', type: 'number' },
      { key: 'qc_rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'pending_qty', label: 'Pending', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
      { key: 'pending_value', label: 'Pending Value', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_late', label: 'Days Late', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const vendor = likeFilter(filters['vendor']);
    const poType = enumFilter(filters['poType'], PO_TYPES);
    const status = enumFilter(filters['status'], PO_STATUSES);
    const onlyPending = filters['onlyPending'] === 'yes';

    const fromFrag = fromDate ? sql`AND po.po_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND po.po_date <= ${toDate}::date` : sql``;
    const vendorFrag = vendor
      ? sql`AND (v.name ILIKE ${vendor} OR v.code ILIKE ${vendor}
                 OR po.vendor_code_text ILIKE ${vendor})`
      : sql``;
    const typeFrag = poType ? sql`AND po.po_type = ${poType}::po_type` : sql``;
    const statusFrag = status
      ? sql`AND po.status = ${status}::po_status`
      : sql`AND po.status NOT IN ('draft', 'cancelled')`;
    const pendingFrag = onlyPending ? sql`WHERE x.pending_qty > 0` : sql``;

    const result = await tx.execute(sql`
      SELECT
        x.po_code, x.po_date, x.po_type, x.po_status, x.vendor_name, x.line_no,
        x.item_code, x.item_name, x.qty, x.received_qty, x.qc_accepted_qty,
        x.qc_rejected_qty, x.pending_qty, x.rate, x.due_date,
        (x.pending_qty * x.rate)::numeric(14, 2) AS pending_value,
        CASE
          WHEN x.due_date IS NULL THEN NULL
          WHEN x.pending_qty > 0 THEN GREATEST(0, CURRENT_DATE - x.due_date)
          WHEN x.last_grn_date IS NOT NULL THEN GREATEST(0, x.last_grn_date - x.due_date)
          ELSE 0
        END AS days_late
      FROM (
        SELECT
          po.code                                          AS po_code,
          po.po_date                                       AS po_date,
          po.po_type::text                                 AS po_type,
          po.status::text                                  AS po_status,
          COALESCE(v.name, po.vendor_code_text)            AS vendor_name,
          pol.line_no                                      AS line_no,
          COALESCE(it.code, pol.item_code_text, '—')       AS item_code,
          COALESCE(it.name, pol.item_name)                 AS item_name,
          pol.qty                                          AS qty,
          pol.received_qty                                 AS received_qty,
          COALESCE(g.accepted, 0)::int                     AS qc_accepted_qty,
          COALESCE(g.rejected, 0)::int                     AS qc_rejected_qty,
          -- ADR-189: a closed / cancelled / short-closed PO owes nothing more.
          CASE
            WHEN po.short_closed_at IS NOT NULL OR po.status IN ('closed', 'cancelled') THEN 0
            ELSE GREATEST(0, pol.qty - pol.received_qty)
          END::int                                         AS pending_qty,
          pol.rate::numeric                                AS rate,
          COALESCE(pol.due_date, po.due_date)              AS due_date,
          g.last_grn_date                                  AS last_grn_date
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po
          ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
        LEFT JOIN public.vendors v ON v.id = po.vendor_id AND v.deleted_at IS NULL
        LEFT JOIN public.items it ON it.id = pol.item_id AND it.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT SUM(grl.qc_accepted_qty) AS accepted,
                 SUM(grl.qc_rejected_qty) AS rejected,
                 MAX(grn.grn_date)        AS last_grn_date
          FROM public.goods_receipt_note_lines grl
          JOIN public.goods_receipt_notes grn
            ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
          WHERE grl.purchase_order_line_id = pol.id
            AND grl.deleted_at IS NULL
        ) g ON TRUE
        WHERE pol.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL
          ${fromFrag}
          ${toFrag}
          ${vendorFrag}
          ${typeFrag}
          ${statusFrag}
      ) x
      ${pendingFrag}
      ORDER BY x.po_date DESC, x.po_code, x.line_no
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      po_code: String(r['po_code'] ?? ''),
      po_date: dateOrNull(r['po_date']),
      po_type: String(r['po_type'] ?? ''),
      po_status: String(r['po_status'] ?? ''),
      vendor_name: (r['vendor_name'] as string | null) ?? null,
      line_no: Number(r['line_no'] ?? 0),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      qty: Number(r['qty'] ?? 0),
      received_qty: Number(r['received_qty'] ?? 0),
      qc_accepted_qty: Number(r['qc_accepted_qty'] ?? 0),
      qc_rejected_qty: Number(r['qc_rejected_qty'] ?? 0),
      pending_qty: Number(r['pending_qty'] ?? 0),
      rate: Number(r['rate'] ?? 0),
      pending_value: Number(r['pending_value'] ?? 0),
      due_date: dateOrNull(r['due_date']),
      days_late: r['days_late'] != null ? Number(r['days_late']) : null,
    }));

    return { columns: poLineAnalysisReport.definition.columns, rows };
  },
};
