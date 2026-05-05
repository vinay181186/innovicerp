// GRN-QC log — flat list of GRN lines with QC status, accept/reject qty,
// inspector, date over a date range. Pattern: list with date-range +
// QC status enum filter. Surfaces inspection backlog and aged-pending
// QC work that's been sitting too long.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const grnQcLogReport: RegisteredReport = {
  definition: {
    slug: 'grn-qc-log',
    title: 'GRN QC log',
    description:
      'Per-line QC status of received goods. Filter by QC status to scope to pending/in-progress/completed. Sorted by GRN date desc.',
    group: 'Quality',
    filters: [
      { key: 'fromDate', label: 'GRN from', kind: 'date' },
      { key: 'toDate', label: 'GRN to', kind: 'date' },
      {
        key: 'qcStatus',
        label: 'QC status',
        kind: 'enum',
        options: ['pending', 'in_progress', 'completed'],
      },
    ],
    columns: [
      { key: 'grn_code', label: 'GRN no.', type: 'text' },
      { key: 'grn_date', label: 'GRN date', type: 'date' },
      { key: 'line_no', label: 'Line', type: 'number' },
      { key: 'item_code', label: 'Item code', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'received_qty', label: 'Received qty', type: 'number' },
      { key: 'qc_status', label: 'QC status', type: 'text' },
      { key: 'qc_accepted_qty', label: 'Accepted', type: 'number' },
      { key: 'qc_rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'qc_date', label: 'QC date', type: 'date' },
      { key: 'po_code', label: 'PO no.', type: 'text' },
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = filters['fromDate'];
    const toDate = filters['toDate'];
    const qcStatus = filters['qcStatus'];
    const validQcStatus = ['pending', 'in_progress', 'completed'];

    const fromFrag = fromDate ? sql`AND grn.grn_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND grn.grn_date <= ${toDate}::date` : sql``;
    const qcFrag =
      qcStatus && validQcStatus.includes(qcStatus)
        ? sql`AND grnl.qc_status = ${qcStatus}::grn_qc_status`
        : sql``;

    const result = await tx.execute(sql`
      SELECT
        grn.code                                       AS grn_code,
        grn.grn_date                                   AS grn_date,
        grnl.line_no                                   AS line_no,
        COALESCE(it.code, grnl.item_code_text, '—')    AS item_code,
        COALESCE(it.name, grnl.item_name)              AS item_name,
        grnl.received_qty                              AS received_qty,
        grnl.qc_status::text                           AS qc_status,
        grnl.qc_accepted_qty                           AS qc_accepted_qty,
        grnl.qc_rejected_qty                           AS qc_rejected_qty,
        grnl.qc_date                                   AS qc_date,
        po.code                                        AS po_code,
        v.name                                         AS vendor_name
      FROM public.goods_receipt_note_lines grnl
      JOIN public.goods_receipt_notes grn ON grn.id = grnl.goods_receipt_note_id
      LEFT JOIN public.items it ON it.id = grnl.item_id
      LEFT JOIN public.purchase_orders po ON po.id = grn.purchase_order_id
      LEFT JOIN public.vendors v ON v.id = grn.vendor_id AND v.deleted_at IS NULL
      WHERE grnl.company_id = ${companyId}::uuid
        AND grnl.deleted_at IS NULL
        AND grn.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${qcFrag}
      ORDER BY grn.grn_date DESC, grn.code, grnl.line_no
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      grn_code: String(r['grn_code'] ?? ''),
      grn_date:
        r['grn_date'] instanceof Date
          ? r['grn_date'].toISOString().slice(0, 10)
          : String(r['grn_date'] ?? ''),
      line_no: r['line_no'] != null ? Number(r['line_no']) : 0,
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      received_qty: Number(r['received_qty'] ?? 0),
      qc_status: String(r['qc_status'] ?? ''),
      qc_accepted_qty: Number(r['qc_accepted_qty'] ?? 0),
      qc_rejected_qty: Number(r['qc_rejected_qty'] ?? 0),
      qc_date:
        r['qc_date'] instanceof Date
          ? r['qc_date'].toISOString().slice(0, 10)
          : r['qc_date'] != null
            ? String(r['qc_date'])
            : null,
      po_code: (r['po_code'] as string | null) ?? null,
      vendor_name: (r['vendor_name'] as string | null) ?? null,
    }));

    return { columns: grnQcLogReport.definition.columns, rows };
  },
};
