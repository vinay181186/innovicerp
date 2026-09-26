// HSN-wise outward summary (GSTR-1 Table 12) — sales invoice lines in a date
// range grouped by the item's HSN code, UOM and GST %, with qty, taxable value
// and tax. JW invoices are left out: they bill a job-work service (SAC), not
// the item's HSN.
// Modelled on ERPNext's India "HSN-wise-summary of outward supplies" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { isoDateFilter, numCell, type SqlRow, textCell } from './report-helpers';

export const hsnOutwardSummaryReport: RegisteredReport = {
  definition: {
    slug: 'hsn-outward-summary',
    title: 'HSN-wise outward summary (GSTR-1 Table 12)',
    description:
      'Sales invoice lines in the Invoice Date range (this month when blank), one row per HSN + UOM + GST %. HSN comes from the Item Master of the SO line item (the invoice line item when the SO line is gone). Tax Amount = line amount × the invoice GST %. JW invoices are not included (job-work labour is a service, not the item HSN).',
    group: 'Finance',
    dept: 'finance',
    showsMoney: true,
    filters: [
      { key: 'fromDate', label: 'Invoice Date From', kind: 'date' },
      { key: 'toDate', label: 'Invoice Date To', kind: 'date' },
    ],
    columns: [
      { key: 'hsn_code', label: 'HSN', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'total_qty', label: 'Total Qty', type: 'number' },
      { key: 'taxable_value', label: 'Taxable Value', type: 'number' },
      { key: 'gst_percent', label: 'GST %', type: 'number' },
      { key: 'tax_amount', label: 'Tax Amount', type: 'number' },
      { key: 'total_value', label: 'Total Value', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const fromExpr = fromDate
      ? sql`${fromDate}::date`
      : sql`date_trunc('month', CURRENT_DATE)::date`;
    const toExpr = toDate
      ? sql`${toDate}::date`
      : sql`(date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date`;

    const result = await tx.execute(sql`
      SELECT
        COALESCE(NULLIF(TRIM(it.hsn_code), ''), '(no HSN)')      AS hsn_code,
        MIN(COALESCE(it.name, il.item_name))                     AS description,
        COALESCE(it.uom::text, sol.uom::text)                    AS uom,
        SUM(il.qty)::int                                         AS total_qty,
        SUM(il.line_amount)::float                               AS taxable_value,
        inv.gst_percent::float                                   AS gst_percent,
        ROUND(SUM(il.line_amount * inv.gst_percent / 100), 2)::float AS tax_amount,
        (SUM(il.line_amount)
          + ROUND(SUM(il.line_amount * inv.gst_percent / 100), 2))::float AS total_value
      FROM public.invoice_lines il
      JOIN public.invoices inv
        ON inv.id = il.invoice_id AND inv.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = il.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.items it
        ON it.id = COALESCE(sol.item_id, il.item_id) AND it.deleted_at IS NULL
      WHERE il.company_id = ${companyId}::uuid
        AND il.deleted_at IS NULL
        AND inv.invoice_date >= ${fromExpr}
        AND inv.invoice_date <= ${toExpr}
      GROUP BY
        COALESCE(NULLIF(TRIM(it.hsn_code), ''), '(no HSN)'),
        COALESCE(it.uom::text, sol.uom::text),
        inv.gst_percent
      ORDER BY 1, 3, 6
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      hsn_code: String(r['hsn_code'] ?? ''),
      description: textCell(r['description']),
      uom: textCell(r['uom']),
      total_qty: numCell(r['total_qty']),
      taxable_value: numCell(r['taxable_value']),
      gst_percent: numCell(r['gst_percent']),
      tax_amount: numCell(r['tax_amount']),
      total_value: numCell(r['total_value']),
    }));

    return { columns: hsnOutwardSummaryReport.definition.columns, rows };
  },
};
