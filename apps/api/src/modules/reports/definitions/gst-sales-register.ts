// GST sales register — one row per outward invoice (sales invoices and JW
// invoices) with the customer's GSTIN and state, the taxable value and the
// GST split into CGST + SGST (same state) or IGST (other state).
// Modelled on ERPNext's "Sales Register" / India "GST Sales Register" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  isoDateFilter,
  likeFilter,
  numCell,
  type SqlRow,
  textCell,
} from './report-helpers';

// Same-state test for a sales invoice when no tax type is stored. Mirrors the
// printed tax invoice (web invoices/lib/print.ts): the customer GSTIN's
// 2-digit state code against ours (our GSTIN's prefix; '24' Gujarat — the
// print's own default — when the company has no GSTIN). With no customer
// GSTIN, the two master-data states are compared; with neither, the print
// treats it as same-state and so does this.
function interStateSql(clientGst: string, clientState: string) {
  return sql.raw(`(CASE
    WHEN ${clientGst} ~ '^[0-9]{2}' THEN LEFT(${clientGst}, 2) <> co.home_code
    WHEN NULLIF(TRIM(${clientState}), '') IS NOT NULL AND co.home_state IS NOT NULL
      THEN LOWER(TRIM(${clientState})) <> co.home_state
    ELSE false
  END)`);
}

export const gstSalesRegisterReport: RegisteredReport = {
  definition: {
    slug: 'gst-sales-register',
    title: 'GST sales register',
    description:
      'Every sales invoice and JW invoice in the date range: Customer GSTIN and state, Taxable Value, GST % and the GST split — CGST + SGST half each when the customer is in our state, IGST otherwise. A JW invoice uses the tax type stored on it; a sales invoice decides by GSTIN state code, exactly as its print does.',
    group: 'Finance',
    dept: 'finance',
    showsMoney: true,
    filters: [
      { key: 'fromDate', label: 'Invoice Date From', kind: 'date' },
      { key: 'toDate', label: 'Invoice Date To', kind: 'date' },
      { key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' },
    ],
    columns: [
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'invoice_code', label: 'Invoice No.', type: 'text' },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'client_gstin', label: 'Customer GSTIN', type: 'text' },
      { key: 'client_state', label: 'Customer State', type: 'text' },
      { key: 'taxable_value', label: 'Taxable Value', type: 'number' },
      { key: 'gst_percent', label: 'GST %', type: 'number' },
      { key: 'cgst', label: 'CGST', type: 'number' },
      { key: 'sgst', label: 'SGST', type: 'number' },
      { key: 'igst', label: 'IGST', type: 'number' },
      { key: 'total', label: 'Invoice Total', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const customer = likeFilter(filters['customer']);

    const invFrom = fromDate ? sql`AND inv.invoice_date >= ${fromDate}::date` : sql``;
    const invTo = toDate ? sql`AND inv.invoice_date <= ${toDate}::date` : sql``;
    const jwFrom = fromDate ? sql`AND ji.invoice_date >= ${fromDate}::date` : sql``;
    const jwTo = toDate ? sql`AND ji.invoice_date <= ${toDate}::date` : sql``;
    const invCustomer = customer
      ? sql`AND COALESCE(cl.name, inv.client_name_text, '') ILIKE ${customer}`
      : sql``;
    const jwCustomer = customer
      ? sql`AND COALESCE(cl.name, jwo.customer_name, '') ILIKE ${customer}`
      : sql``;

    const soInter = interStateSql(
      `COALESCE(NULLIF(TRIM(inv.client_gst_text), ''), cl.gst_number, '')`,
      'cl.state',
    );
    const jwInter = interStateSql(`COALESCE(cl.gst_number, '')`, 'cl.state');

    const result = await tx.execute(sql`
      WITH co AS (
        SELECT
          COALESCE(
            CASE WHEN c.gst_number ~ '^[0-9]{2}' THEN LEFT(c.gst_number, 2) END,
            '24'
          )                                          AS home_code,
          LOWER(NULLIF(TRIM(c.state), ''))           AS home_state
        FROM public.companies c
        WHERE c.id = ${companyId}::uuid
      ),
      reg AS (
        SELECT
          'Sales Invoice'                                            AS source,
          inv.code                                                   AS invoice_code,
          inv.invoice_date                                           AS invoice_date,
          COALESCE(cl.name, inv.client_name_text, '—')               AS client_name,
          COALESCE(NULLIF(TRIM(inv.client_gst_text), ''), cl.gst_number) AS client_gstin,
          cl.state                                                   AS client_state,
          inv.subtotal                                               AS taxable_value,
          inv.gst_percent                                            AS gst_percent,
          inv.gst_amount                                             AS gst_amount,
          inv.grand_total                                            AS total,
          ${soInter}                                                 AS is_inter
        FROM public.invoices inv
        CROSS JOIN co
        LEFT JOIN public.clients cl
          ON cl.id = inv.client_id AND cl.deleted_at IS NULL
        WHERE inv.company_id = ${companyId}::uuid
          AND inv.deleted_at IS NULL
          ${invFrom}
          ${invTo}
          ${invCustomer}

        UNION ALL

        SELECT
          'JW Invoice'                                               AS source,
          ji.code                                                    AS invoice_code,
          ji.invoice_date                                            AS invoice_date,
          COALESCE(cl.name, jwo.customer_name, '—')                  AS client_name,
          cl.gst_number                                              AS client_gstin,
          cl.state                                                   AS client_state,
          ji.taxable_amount                                          AS taxable_value,
          ji.gst_percent                                             AS gst_percent,
          ji.gst_amount                                              AS gst_amount,
          ji.total_amount                                            AS total,
          CASE ji.tax_type
            WHEN 'igst' THEN true
            WHEN 'sgst_cgst' THEN false
            ELSE ${jwInter}
          END                                                        AS is_inter
        FROM public.jw_invoices ji
        CROSS JOIN co
        LEFT JOIN public.job_work_orders jwo
          ON jwo.id = ji.job_work_order_id AND jwo.deleted_at IS NULL
        LEFT JOIN public.clients cl
          ON cl.id = COALESCE(ji.client_id, jwo.client_id) AND cl.deleted_at IS NULL
        WHERE ji.company_id = ${companyId}::uuid
          AND ji.deleted_at IS NULL
          ${jwFrom}
          ${jwTo}
          ${jwCustomer}
      )
      SELECT
        source,
        invoice_code,
        invoice_date::text                                         AS invoice_date,
        client_name,
        client_gstin,
        client_state,
        taxable_value::float                                       AS taxable_value,
        gst_percent::float                                         AS gst_percent,
        CASE WHEN is_inter THEN 0 ELSE ROUND(gst_amount / 2, 2) END::float AS cgst,
        CASE WHEN is_inter THEN 0 ELSE gst_amount - ROUND(gst_amount / 2, 2) END::float AS sgst,
        CASE WHEN is_inter THEN gst_amount ELSE 0 END::float       AS igst,
        total::float                                               AS total
      FROM reg
      ORDER BY reg.invoice_date DESC, reg.invoice_code DESC
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      source: String(r['source'] ?? ''),
      invoice_code: String(r['invoice_code'] ?? ''),
      invoice_date: dateCell(r['invoice_date']),
      client_name: String(r['client_name'] ?? ''),
      client_gstin: textCell(r['client_gstin']),
      client_state: textCell(r['client_state']),
      taxable_value: numCell(r['taxable_value']),
      gst_percent: numCell(r['gst_percent']),
      cgst: numCell(r['cgst']),
      sgst: numCell(r['sgst']),
      igst: numCell(r['igst']),
      total: numCell(r['total']),
    }));

    return { columns: gstSalesRegisterReport.definition.columns, rows };
  },
};
