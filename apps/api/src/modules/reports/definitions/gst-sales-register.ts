// GST sales register — one row per outward invoice (sales invoices and JW
// invoices) with the customer's GSTIN and state, the taxable value and the
// GST split into CGST + SGST (same state) or IGST (other state).
// Modelled on ERPNext's "Sales Register" / India "GST Sales Register" report.

import { sql } from 'drizzle-orm';
import { placeOfSupplyLabel } from '@innovic/shared';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  isoDateFilter,
  likeFilter,
  numCell,
  type SqlRow,
  textCell,
} from './report-helpers';

// Customer name, GSTIN and State come from the invoice's OWN legal copy
// (migration 0186, plan D7) — what was billed, not what the master says now.
// Only a row with no copy (client_copy_at NULL) reads the live customer.
//
// Same-state test when an invoice stores no tax type: its Place of Supply (else
// the GSTIN's first two digits) against the company's State Code (company
// GSTIN prefix). No home-state default (plan D2): with either side unknown the
// row is treated as same-state, as the invoice itself was billed in warn mode.
function interStateSql(pos: string, gstin: string) {
  return sql.raw(`(CASE
    WHEN co.home_code IS NULL THEN false
    WHEN ${pos} IS NOT NULL THEN ${pos} <> co.home_code
    WHEN ${gstin} ~ '^[0-9]{2}' THEN LEFT(${gstin}, 2) <> co.home_code
    ELSE false
  END)`);
}

export const gstSalesRegisterReport: RegisteredReport = {
  definition: {
    slug: 'gst-sales-register',
    title: 'GST sales register',
    description:
      "Every sales invoice and JW invoice in the date range: Customer, GSTIN, State and Place of Supply as billed (the invoice's own copy), Taxable Value, GST % and the GST split — CGST + SGST half each when the Place of Supply is our State, IGST otherwise. Each invoice uses the tax type stored on it.",
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
      { key: 'place_of_supply', label: 'Place of Supply', type: 'text' },
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
      ? sql`AND COALESCE(inv.client_name_text, cl.name, '') ILIKE ${customer}`
      : sql``;
    const jwCustomer = customer
      ? sql`AND COALESCE(ji.client_name_text, cl.name, jwo.customer_name, '') ILIKE ${customer}`
      : sql``;

    const soInter = interStateSql(
      'inv.place_of_supply',
      `COALESCE(NULLIF(TRIM(inv.client_gst_text), ''), CASE WHEN inv.client_copy_at IS NULL THEN cl.gst_number END, '')`,
    );
    const jwInter = interStateSql(
      'ji.place_of_supply',
      `COALESCE(NULLIF(TRIM(ji.client_gst_text), ''), CASE WHEN ji.client_copy_at IS NULL THEN cl.gst_number END, '')`,
    );

    const result = await tx.execute(sql`
      WITH co AS (
        SELECT
          CASE WHEN c.gst_number ~ '^[0-9]{2}' THEN LEFT(c.gst_number, 2) END AS home_code
        FROM public.companies c
        WHERE c.id = ${companyId}::uuid
      ),
      reg AS (
        SELECT
          'Sales Invoice'                                            AS source,
          inv.code                                                   AS invoice_code,
          inv.invoice_date                                           AS invoice_date,
          COALESCE(inv.client_name_text, cl.name, '—')               AS client_name,
          CASE WHEN inv.client_copy_at IS NOT NULL THEN inv.client_gst_text
               ELSE COALESCE(NULLIF(TRIM(inv.client_gst_text), ''), cl.gst_number) END AS client_gstin,
          CASE WHEN inv.client_copy_at IS NOT NULL THEN inv.client_state
               ELSE cl.state END                                     AS client_state,
          inv.place_of_supply                                        AS place_of_supply,
          inv.subtotal                                               AS taxable_value,
          inv.gst_percent                                            AS gst_percent,
          inv.gst_amount                                             AS gst_amount,
          inv.grand_total                                            AS total,
          CASE inv.tax_type
            WHEN 'igst' THEN true
            WHEN 'sgst_cgst' THEN false
            ELSE ${soInter}
          END                                                        AS is_inter
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
          COALESCE(ji.client_name_text, cl.name, jwo.customer_name, '—') AS client_name,
          CASE WHEN ji.client_copy_at IS NOT NULL THEN ji.client_gst_text
               ELSE cl.gst_number END                                AS client_gstin,
          CASE WHEN ji.client_copy_at IS NOT NULL THEN ji.client_state
               ELSE cl.state END                                     AS client_state,
          ji.place_of_supply                                         AS place_of_supply,
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
        place_of_supply::text                                      AS place_of_supply,
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
      place_of_supply: textCell(
        r['place_of_supply'] ? placeOfSupplyLabel(String(r['place_of_supply'])) : null,
      ),
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
