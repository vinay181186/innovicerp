// Vendor rejection report — per vendor × item × source over a GRN date range:
// Received, Incoming QC Inspected / Rejected, Reject % and the NCs raised on
// those GRN lines. 'Material' = bought goods; 'OSP' = our parts back from a
// job-work / service vendor (DC receipt → auto-GRN, ADR-182; inspected at
// Incoming QC, ADR-189). Modelled on ERPNext's "Supplier-wise Rejection" view.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { isoDateFilter, likeFilter } from './report-helpers';

export const vendorRejectionReport: RegisteredReport = {
  definition: {
    slug: 'vendor-rejection',
    title: 'Vendor rejection report',
    description:
      'Per vendor and item, split Material / OSP: Received, Inspected and Rejected at Incoming QC, Reject %, and the count of NCs raised on those GRN lines. By GRN Date.',
    group: 'Quality',
    dept: 'qc',
    filters: [
      { key: 'fromDate', label: 'GRN Date From', kind: 'date' },
      { key: 'toDate', label: 'GRN Date To', kind: 'date' },
      { key: 'vendor', label: 'Vendor', kind: 'text', placeholder: 'Vendor name or code' },
    ],
    columns: [
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'source', label: 'Receipt Source', type: 'text' },
      { key: 'received_qty', label: 'Received', type: 'number' },
      { key: 'inspected_qty', label: 'Inspected', type: 'number' },
      { key: 'rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'reject_pct', label: 'Reject %', type: 'number' },
      { key: 'nc_count', label: 'NCs', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const vendor = likeFilter(filters['vendor']);

    const fromFrag = fromDate ? sql`AND grn.grn_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND grn.grn_date <= ${toDate}::date` : sql``;
    const vendorFrag = vendor
      ? sql`AND (v.name ILIKE ${vendor} OR v.code ILIKE ${vendor}
                 OR grn.vendor_code_text ILIKE ${vendor})`
      : sql``;

    // OSP = PO types that send our material out (packages/shared
    // poSendsMaterialOut: job_work, service). A GRN with no PO is Material.
    const result = await tx.execute(sql`
      SELECT
        COALESCE(v.name, grn.vendor_code_text, '—')                  AS vendor_name,
        COALESCE(it.code, grl.item_code_text, '—')                   AS item_code,
        MAX(COALESCE(it.name, grl.item_name))                        AS item_name,
        CASE WHEN po.po_type IN ('job_work', 'service') THEN 'OSP' ELSE 'Material' END AS source,
        SUM(grl.received_qty)::int                                   AS received_qty,
        SUM(grl.qc_accepted_qty + grl.qc_rejected_qty)::int          AS inspected_qty,
        SUM(grl.qc_rejected_qty)::int                                AS rejected_qty,
        CASE WHEN SUM(grl.qc_accepted_qty + grl.qc_rejected_qty) > 0
             THEN ROUND(100.0 * SUM(grl.qc_rejected_qty)
                        / SUM(grl.qc_accepted_qty + grl.qc_rejected_qty), 1) END AS reject_pct,
        COALESCE(SUM(nc.nc_count), 0)::int                           AS nc_count
      FROM public.goods_receipt_note_lines grl
      JOIN public.goods_receipt_notes grn
        ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = grn.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.vendors v
        ON v.id = COALESCE(grn.vendor_id, po.vendor_id) AND v.deleted_at IS NULL
      LEFT JOIN public.items it ON it.id = grl.item_id AND it.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS nc_count
        FROM public.nc_register n
        WHERE n.grn_line_id = grl.id AND n.deleted_at IS NULL
      ) nc ON TRUE
      WHERE grl.company_id = ${companyId}::uuid
        AND grl.deleted_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${vendorFrag}
      GROUP BY COALESCE(v.id::text, grn.vendor_code_text, '—'),
               COALESCE(v.name, grn.vendor_code_text, '—'),
               COALESCE(it.code, grl.item_code_text, '—'),
               CASE WHEN po.po_type IN ('job_work', 'service') THEN 'OSP' ELSE 'Material' END
      ORDER BY rejected_qty DESC, vendor_name, item_code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      vendor_name: String(r['vendor_name'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      source: String(r['source'] ?? ''),
      received_qty: Number(r['received_qty'] ?? 0),
      inspected_qty: Number(r['inspected_qty'] ?? 0),
      rejected_qty: Number(r['rejected_qty'] ?? 0),
      reject_pct: r['reject_pct'] != null ? Number(r['reject_pct']) : null,
      nc_count: Number(r['nc_count'] ?? 0),
    }));

    return { columns: vendorRejectionReport.definition.columns, rows };
  },
};
