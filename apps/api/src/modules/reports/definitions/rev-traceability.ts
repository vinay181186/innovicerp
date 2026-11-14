// ADR-292 report 4 — Drawing Rev traceability: customer → SO line (order Rev)
// → Job Card (its Rev) → QC results on that card → what was dispatched (shipped
// Rev × qty) → what was invoiced (invoice line Rev × qty). One row per SO line
// and Job Card; dispatch / invoice figures are per SO line.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { likeFilter, numCell, REPORT_ROW_CAP, textCell, type SqlRow } from './report-helpers';

export const revTraceabilityReport: RegisteredReport = {
  definition: {
    slug: 'rev-traceability',
    title: 'Drawing Rev Traceability',
    description:
      'Customer → SO line (order Rev) → Job Card (its Rev) → QC results → dispatched Rev and qty → invoiced Rev and qty.',
    group: 'Design',
    dept: 'design',
    filters: [
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      { key: 'so', label: 'SO No.', kind: 'text', placeholder: 'SO No. or Internal SO No.' },
    ],
    columns: [
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'line_no', label: 'Ln', type: 'number' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'order_rev', label: 'Order Rev', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'jc_rev', label: 'JC Rev', type: 'text' },
      { key: 'qc_results', label: 'QC Results', type: 'number' },
      { key: 'dispatched', label: 'Dispatched (Rev × Qty)', type: 'text' },
      { key: 'invoiced', label: 'Invoiced (Rev × Qty)', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const item = likeFilter(filters['item']);
    const so = likeFilter(filters['so']);
    const result = await tx.execute(sql`
      SELECT COALESCE(c.name, h.customer_name) AS customer, h.code AS so_code, l.line_no,
             l.client_po_line_no, i.code AS item_code, lr.rev AS order_rev,
             jc.code AS jc_code, jr.rev AS jc_rev,
             (SELECT COUNT(*) FROM public.op_log ol
                JOIN public.jc_ops o ON o.id = ol.jc_op_id
               WHERE o.job_card_id = jc.id AND ol.log_type = 'qc'
                 AND ol.reversal_of_id IS NULL)::int AS qc_results,
             (SELECT string_agg(COALESCE(dr.rev, 'no Rev') || ' × ' || d.q, ', ' ORDER BY dr.rev)
                FROM (SELECT cdl.item_revision_id, SUM(cdl.qty) AS q
                        FROM public.customer_dispatch_lines cdl
                        JOIN public.customer_dispatches cd ON cd.id = cdl.customer_dispatch_id
                       WHERE cdl.sales_order_line_id = l.id AND cdl.deleted_at IS NULL
                         AND cd.deleted_at IS NULL AND cd.status <> 'cancelled'
                       GROUP BY cdl.item_revision_id) d
                LEFT JOIN public.item_revisions dr ON dr.id = d.item_revision_id) AS dispatched,
             (SELECT string_agg(COALESCE(vr.rev, 'no Rev') || ' × ' || v.q, ', ' ORDER BY vr.rev)
                FROM (SELECT il.item_revision_id, SUM(il.qty) AS q
                        FROM public.invoice_lines il
                        JOIN public.invoices inv ON inv.id = il.invoice_id
                       WHERE il.sales_order_line_id = l.id AND il.deleted_at IS NULL
                         AND inv.deleted_at IS NULL AND inv.cancelled_at IS NULL
                       GROUP BY il.item_revision_id) v
                LEFT JOIN public.item_revisions vr ON vr.id = v.item_revision_id) AS invoiced
        FROM public.sales_order_lines l
        JOIN public.sales_orders h ON h.id = l.sales_order_id AND h.deleted_at IS NULL
        LEFT JOIN public.clients c ON c.id = h.client_id
        LEFT JOIN public.items i ON i.id = l.item_id
        LEFT JOIN public.item_revisions lr ON lr.id = l.item_revision_id
        LEFT JOIN public.job_cards jc
          ON jc.source_so_line_id = l.id AND jc.deleted_at IS NULL
        LEFT JOIN public.item_revisions jr ON jr.id = jc.item_revision_id
       WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
         AND l.item_revision_id IS NOT NULL
         ${item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``}
         ${so ? sql`AND (h.code ILIKE ${so} OR COALESCE(h.internal_so_no, '') ILIKE ${so})` : sql``}
       ORDER BY h.code, l.line_no, jc.code
       LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => ({
      customer: textCell(r['customer']),
      so_code: textCell(r['so_code']),
      line_no: numCell(r['line_no']),
      client_po_line_no: textCell(r['client_po_line_no']),
      item_code: textCell(r['item_code']),
      order_rev: textCell(r['order_rev']),
      jc_code: textCell(r['jc_code']),
      jc_rev: textCell(r['jc_rev']),
      qc_results: numCell(r['qc_results']),
      dispatched: textCell(r['dispatched']),
      invoiced: textCell(r['invoiced']),
    }));
    return { columns: revTraceabilityReport.definition.columns, rows };
  },
};
