// OSP material at vendor (ageing) — every outsourced JC op with pieces still
// out at the vendor (v_osp_wip.at_vendor_qty > 0), aged from the earliest DC
// still open against the op's PO line(s), bucketed 0-7 / 8-15 / 16-30 / 30+
// days. Modelled on ERPNext's "Subcontracted Raw Materials To Be Transferred"
// / stock-ageing reports.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell as dateOrNull, likeFilter } from './report-helpers';

export const ospAtVendorReport: RegisteredReport = {
  definition: {
    slug: 'osp-at-vendor',
    title: 'OSP material at vendor (ageing)',
    description:
      'Outsourced JC ops with pieces still at the vendor, aged from the earliest DC still open for the op. The At Vendor qty is repeated in the one age bucket it falls in. Oldest first.',
    group: 'Purchase',
    dept: 'purchase',
    filters: [{ key: 'vendor', label: 'Vendor', kind: 'text', placeholder: 'Vendor name or code' }],
    columns: [
      { key: 'vendor_name', label: 'Vendor', type: 'text' },
      { key: 'dc_code', label: 'DC No.', type: 'text' },
      { key: 'dc_date', label: 'DC Date', type: 'date' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'operation', label: 'Operation', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'sent_qty', label: 'Sent', type: 'number' },
      { key: 'returned_qty', label: 'Returned', type: 'number' },
      { key: 'at_vendor_qty', label: 'At Vendor', type: 'number' },
      { key: 'days_at_vendor', label: 'Days at Vendor', type: 'number' },
      { key: 'bucket_0_7', label: '0-7 Days', type: 'number' },
      { key: 'bucket_8_15', label: '8-15 Days', type: 'number' },
      { key: 'bucket_16_30', label: '16-30 Days', type: 'number' },
      { key: 'bucket_30_plus', label: '30+ Days', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const vendor = likeFilter(filters['vendor']);
    const vendorFrag = vendor
      ? sql`AND (w.vendor_name ILIKE ${vendor} OR w.vendor_code ILIKE ${vendor})`
      : sql``;

    // v_osp_wip is keyed by jc_op_id. An op reaches its DCs through its PO
    // line(s): jc_ops.outsource_po_line_id plus jc_op_po_lines (0118 — one op
    // may sit on several POs), the same union the view itself uses. The DC
    // aged is the earliest one still 'issued'; if none is (a status not yet
    // flipped), the earliest DC of any status, then the op's own sent date.
    const result = await tx.execute(sql`
      SELECT
        x.vendor_name, x.dc_code, x.dc_date, x.jc_code, x.item_code, x.op_seq,
        x.operation, x.so_code, x.sent_qty, x.returned_qty, x.at_vendor_qty,
        x.days_at_vendor,
        CASE WHEN x.days_at_vendor BETWEEN 0 AND 7   THEN x.at_vendor_qty ELSE 0 END AS bucket_0_7,
        CASE WHEN x.days_at_vendor BETWEEN 8 AND 15  THEN x.at_vendor_qty ELSE 0 END AS bucket_8_15,
        CASE WHEN x.days_at_vendor BETWEEN 16 AND 30 THEN x.at_vendor_qty ELSE 0 END AS bucket_16_30,
        CASE WHEN x.days_at_vendor > 30              THEN x.at_vendor_qty ELSE 0 END AS bucket_30_plus
      FROM (
        SELECT
          w.vendor_name,
          d.dc_code,
          COALESCE(d.dc_date, jo.outsource_sent_date)            AS dc_date,
          w.jc_code,
          w.item_code,
          w.op_seq,
          w.operation,
          w.so_code,
          w.sent_qty,
          w.returned_qty,
          w.at_vendor_qty,
          GREATEST(0, CURRENT_DATE - COALESCE(d.dc_date, jo.outsource_sent_date, CURRENT_DATE))::int
                                                                 AS days_at_vendor
        FROM public.v_osp_wip w
        JOIN public.jc_ops jo ON jo.id = w.jc_op_id AND jo.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT dc.code AS dc_code, dc.dc_date
          FROM public.delivery_challans dc
          JOIN public.delivery_challan_lines dcl
            ON dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
          WHERE dc.deleted_at IS NULL
            AND dc.status <> 'cancelled'
            AND dcl.purchase_order_line_id IN (
              SELECT jo.outsource_po_line_id WHERE jo.outsource_po_line_id IS NOT NULL
              UNION
              SELECT l.purchase_order_line_id FROM public.jc_op_po_lines l
              WHERE l.jc_op_id = w.jc_op_id AND l.deleted_at IS NULL
            )
          ORDER BY (dc.status = 'issued') DESC, dc.dc_date, dc.code
          LIMIT 1
        ) d ON TRUE
        WHERE w.company_id = ${companyId}::uuid
          AND w.at_vendor_qty > 0
          ${vendorFrag}
      ) x
      ORDER BY x.days_at_vendor DESC, x.vendor_name, x.jc_code, x.op_seq
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      vendor_name: (r['vendor_name'] as string | null) ?? null,
      dc_code: (r['dc_code'] as string | null) ?? null,
      dc_date: dateOrNull(r['dc_date']),
      jc_code: String(r['jc_code'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      op_seq: Number(r['op_seq'] ?? 0),
      operation: String(r['operation'] ?? ''),
      so_code: (r['so_code'] as string | null) ?? null,
      sent_qty: Number(r['sent_qty'] ?? 0),
      returned_qty: Number(r['returned_qty'] ?? 0),
      at_vendor_qty: Number(r['at_vendor_qty'] ?? 0),
      days_at_vendor: Number(r['days_at_vendor'] ?? 0),
      bucket_0_7: Number(r['bucket_0_7'] ?? 0),
      bucket_8_15: Number(r['bucket_8_15'] ?? 0),
      bucket_16_30: Number(r['bucket_16_30'] ?? 0),
      bucket_30_plus: Number(r['bucket_30_plus'] ?? 0),
    }));

    return { columns: ospAtVendorReport.definition.columns, rows };
  },
};
