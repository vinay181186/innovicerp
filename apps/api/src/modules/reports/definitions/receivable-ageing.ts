// Receivable ageing — every sales invoice with money still owed on the as-on
// date, the amount placed in a Not Due / 0-30 / 31-60 / 61-90 / 90+ days
// overdue column by how far past its Due Date it is.
// Modelled on ERPNext's "Accounts Receivable" report (ageing buckets).

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  isoDateFilter,
  likeFilter,
  numCell,
  REPORT_ROW_CAP,
  textCell,
  type SqlRow,
} from './report-helpers';

export const receivableAgeingReport: RegisteredReport = {
  definition: {
    slug: 'receivable-ageing',
    title: 'Receivable ageing',
    description:
      'Sales invoices dated on or before the As On date (today when blank) with an Outstanding Amount (Grand Total minus payments received and TDS deducted up to that date). Days Overdue counts from the Due Date (Invoice Date + Payment Terms when no Due Date); the Outstanding Amount sits in exactly one ageing column. JW Invoices are not included — they carry no payment record.',
    group: 'Finance',
    dept: 'finance',
    showsMoney: true,
    filters: [
      { key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' },
      { key: 'asOn', label: 'As On Date', kind: 'date' },
    ],
    columns: [
      { key: 'invoice_code', label: 'Invoice No.', type: 'text' },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'grand_total', label: 'Grand Total', type: 'number' },
      { key: 'paid', label: 'Paid', type: 'number' },
      { key: 'tds', label: 'TDS', type: 'number' },
      { key: 'outstanding', label: 'Outstanding Amount', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_overdue', label: 'Days Overdue', type: 'number' },
      { key: 'not_due', label: 'Not Due', type: 'number' },
      { key: 'age_0_30', label: '0-30', type: 'number' },
      { key: 'age_31_60', label: '31-60', type: 'number' },
      { key: 'age_61_90', label: '61-90', type: 'number' },
      { key: 'age_90_plus', label: '90+', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const asOnDate = isoDateFilter(filters['asOn']);
    const customer = likeFilter(filters['customer']);
    const asOn = asOnDate ? sql`${asOnDate}::date` : sql`CURRENT_DATE`;
    const customerFrag = customer
      ? sql`AND COALESCE(cl.name, inv.client_name_text, '') ILIKE ${customer}`
      : sql``;

    const result = await tx.execute(sql`
      WITH base AS (
        SELECT
          inv.code                                            AS invoice_code,
          inv.invoice_date                                    AS invoice_date,
          COALESCE(cl.name, inv.client_name_text, '—')        AS client_name,
          COALESCE(so.code, inv.so_code_text)                 AS so_code,
          so.internal_so_no                                   AS so_internal_no,
          inv.grand_total                                     AS grand_total,
          COALESCE((
            SELECT SUM(ip.amount)
            FROM public.invoice_payments ip
            WHERE ip.invoice_id = inv.id
              AND ip.deleted_at IS NULL
              AND ip.payment_date <= ${asOn}
          ), 0)                                               AS paid,
          -- TDS / short amount the customer deducted (0171) settles the invoice
          -- too: outstanding = grand − paid − TDS, as the invoices service.
          COALESCE((
            SELECT SUM(ip.tds_amount)
            FROM public.invoice_payments ip
            WHERE ip.invoice_id = inv.id
              AND ip.deleted_at IS NULL
              AND ip.payment_date <= ${asOn}
          ), 0)                                               AS tds,
          COALESCE(inv.due_date, inv.invoice_date + inv.payment_terms_days) AS due_date,
          (${asOn} - COALESCE(inv.due_date, inv.invoice_date + inv.payment_terms_days)) AS days_overdue
        FROM public.invoices inv
        LEFT JOIN public.clients cl
          ON cl.id = inv.client_id AND cl.deleted_at IS NULL
        LEFT JOIN public.sales_orders so
          ON so.id = inv.sales_order_id AND so.deleted_at IS NULL
        WHERE inv.company_id = ${companyId}::uuid
          AND inv.deleted_at IS NULL
          -- A cancelled invoice (ADR-202 Phase 3) is not a receivable.
          AND inv.status <> 'cancelled'
          AND inv.invoice_date <= ${asOn}
          ${customerFrag}
      )
      SELECT
        invoice_code,
        invoice_date::text                                   AS invoice_date,
        client_name,
        so_code,
        so_internal_no,
        grand_total::float                                   AS grand_total,
        paid::float                                          AS paid,
        tds::float                                           AS tds,
        (grand_total - paid - tds)::float                    AS outstanding,
        due_date::text                                       AS due_date,
        GREATEST(days_overdue, 0)                            AS days_overdue,
        CASE WHEN days_overdue <= 0 THEN (grand_total - paid - tds) ELSE 0 END::float AS not_due,
        CASE WHEN days_overdue BETWEEN 1 AND 30 THEN (grand_total - paid - tds) ELSE 0 END::float AS age_0_30,
        CASE WHEN days_overdue BETWEEN 31 AND 60 THEN (grand_total - paid - tds) ELSE 0 END::float AS age_31_60,
        CASE WHEN days_overdue BETWEEN 61 AND 90 THEN (grand_total - paid - tds) ELSE 0 END::float AS age_61_90,
        CASE WHEN days_overdue > 90 THEN (grand_total - paid - tds) ELSE 0 END::float AS age_90_plus
      FROM base
      WHERE grand_total - paid - tds > 0.005
      ORDER BY days_overdue DESC, invoice_code
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      invoice_code: String(r['invoice_code'] ?? ''),
      invoice_date: dateCell(r['invoice_date']),
      client_name: String(r['client_name'] ?? ''),
      so_code: textCell(r['so_code']),
      so_internal_no: textCell(r['so_internal_no']),
      grand_total: numCell(r['grand_total']),
      paid: numCell(r['paid']),
      tds: numCell(r['tds']),
      outstanding: numCell(r['outstanding']),
      due_date: dateCell(r['due_date']),
      days_overdue: numCell(r['days_overdue']),
      not_due: numCell(r['not_due']),
      age_0_30: numCell(r['age_0_30']),
      age_31_60: numCell(r['age_31_60']),
      age_61_90: numCell(r['age_61_90']),
      age_90_plus: numCell(r['age_90_plus']),
    }));

    return { columns: receivableAgeingReport.definition.columns, rows };
  },
};
