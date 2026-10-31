// Dispatched but not invoiced — SO lines whose dispatched qty is ahead of the
// invoiced qty, plus JWSO lines whose returned qty is ahead of the JW-invoiced
// qty: the qty and value still to invoice, and how long since it shipped.
// Modelled on ERPNext's "Delivered Items To Be Billed" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  likeFilter,
  numCell,
  REPORT_ROW_CAP,
  textCell,
  type SqlRow,
} from './report-helpers';

export const dispatchedNotInvoicedReport: RegisteredReport = {
  definition: {
    slug: 'dispatched-not-invoiced',
    title: 'Dispatched but not invoiced',
    description:
      'SO lines with Dispatched (cancelled dispatches left out) more than Invoiced, and JWSO lines with Returned more than Invoiced. To Invoice Value = To Invoice × line Rate. Oldest shipment first.',
    group: 'Finance',
    dept: 'finance',
    showsMoney: true,
    priceForm: 'invoice_create',
    filters: [{ key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' }],
    columns: [
      // ADR-261 lead columns: SO No. is the SO or JWSO code the line has;
      // Created On is the order line's created_at; rev rides in Item Code.
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'dispatched_qty', label: 'Dispatched', type: 'number' },
      { key: 'invoiced_qty', label: 'Invoiced', type: 'number' },
      { key: 'to_invoice_qty', label: 'To Invoice', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
      { key: 'to_invoice_value', label: 'To Invoice Value', type: 'number' },
      { key: 'last_dispatch_date', label: 'Last Dispatch Date', type: 'date' },
      { key: 'days_since_dispatch', label: 'Days Since Dispatch', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const customer = likeFilter(filters['customer']);
    const soCustomerFrag = customer
      ? sql`AND COALESCE(cl.name, so.customer_name, '') ILIKE ${customer}`
      : sql``;
    const jwCustomerFrag = customer
      ? sql`AND COALESCE(cl.name, jwo.customer_name, '') ILIKE ${customer}`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        u.source, u.so_code, u.so_internal_no, u.client_name, u.client_po_line_no, u.item_code,
        u.item_name, u.created_on, u.dispatched_qty, u.invoiced_qty, u.to_invoice_qty, u.rate,
        u.to_invoice_value,
        u.last_dispatch_date::text               AS last_dispatch_text,
        (CURRENT_DATE - u.last_dispatch_date)    AS days_since_dispatch
      FROM (
        SELECT
          'SO'                                         AS source,
          so.code                                      AS so_code,
          so.internal_so_no                            AS so_internal_no,
          COALESCE(cl.name, so.customer_name, '—')     AS client_name,
          sol.client_po_line_no                        AS client_po_line_no,
          (COALESCE(it.code, sol.item_code_text)
            || COALESCE('/' || NULLIF(btrim(sol.revision::text), ''), '')) AS item_code,
          COALESCE(it.name, sol.part_name)             AS item_name,
          (sol.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
          d.qty                                        AS dispatched_qty,
          i.qty                                        AS invoiced_qty,
          (d.qty - i.qty)                              AS to_invoice_qty,
          sol.rate                                     AS rate,
          ((d.qty - i.qty) * sol.rate)::numeric(14, 2) AS to_invoice_value,
          d.last_date                                  AS last_dispatch_date,
          sol.line_no                                  AS line_no
        FROM public.sales_order_lines sol
        JOIN public.sales_orders so
          ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
        LEFT JOIN public.items it
          ON it.id = sol.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.clients cl
          ON cl.id = so.client_id AND cl.deleted_at IS NULL
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(cdl.qty), 0)::int AS qty, MAX(cd.dispatch_date) AS last_date
          FROM public.customer_dispatch_lines cdl
          JOIN public.customer_dispatches cd
            ON cd.id = cdl.customer_dispatch_id AND cd.deleted_at IS NULL
          WHERE cdl.sales_order_line_id = sol.id
            AND cdl.deleted_at IS NULL
            AND cd.status <> 'cancelled'
        ) d
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(il.qty), 0)::int AS qty
          FROM public.invoice_lines il
          JOIN public.invoices inv
            ON inv.id = il.invoice_id AND inv.deleted_at IS NULL
            AND inv.status <> 'cancelled'
          WHERE il.sales_order_line_id = sol.id
            AND il.deleted_at IS NULL
        ) i
        WHERE sol.company_id = ${companyId}::uuid
          AND sol.deleted_at IS NULL
          AND sol.status <> 'cancelled'
          AND d.qty > i.qty
          ${soCustomerFrag}

        UNION ALL

        SELECT
          'JWSO'                                       AS source,
          jwo.code                                     AS so_code,
          NULL::text                                   AS so_internal_no,
          COALESCE(cl.name, jwo.customer_name, '—')    AS client_name,
          jwl.client_po_line_no                        AS client_po_line_no, -- ADR-236
          (COALESCE(it.code, jwl.item_code_text)
            || COALESCE('/' || NULLIF(btrim(jwl.revision::text), ''), '')) AS item_code,
          COALESCE(it.name, jwl.part_name)             AS item_name,
          (jwl.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
          jwl.returned_qty                             AS dispatched_qty,
          jwl.invoiced_qty                             AS invoiced_qty,
          (jwl.returned_qty - jwl.invoiced_qty)        AS to_invoice_qty,
          jwl.rate                                     AS rate,
          ((jwl.returned_qty - jwl.invoiced_qty) * jwl.rate)::numeric(14, 2) AS to_invoice_value,
          (SELECT MAX(rc.return_date)
           FROM public.jw_return_challans rc
           WHERE rc.job_work_order_line_id = jwl.id
             AND rc.deleted_at IS NULL
             AND rc.status <> 'cancelled')             AS last_dispatch_date,
          jwl.line_no                                  AS line_no
        FROM public.job_work_order_lines jwl
        JOIN public.job_work_orders jwo
          ON jwo.id = jwl.job_work_order_id AND jwo.deleted_at IS NULL
        LEFT JOIN public.items it
          ON it.id = jwl.item_id AND it.deleted_at IS NULL
        LEFT JOIN public.clients cl
          ON cl.id = jwo.client_id AND cl.deleted_at IS NULL
        WHERE jwl.company_id = ${companyId}::uuid
          AND jwl.deleted_at IS NULL
          AND jwl.status <> 'cancelled'
          AND jwl.returned_qty > jwl.invoiced_qty
          ${jwCustomerFrag}
      ) u
      ORDER BY u.last_dispatch_date ASC NULLS LAST, u.so_code, u.line_no
      LIMIT ${REPORT_ROW_CAP}
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => {
      const last = dateCell(r['last_dispatch_text']);
      return {
        so_code: String(r['so_code'] ?? ''),
        so_internal_no: textCell(r['so_internal_no']),
        client_po_line_no: textCell(r['client_po_line_no']),
        created_on: dateCell(r['created_on']),
        item_code: String(r['item_code'] ?? '—'),
        item_name: textCell(r['item_name']),
        source: String(r['source'] ?? ''),
        client_name: String(r['client_name'] ?? ''),
        dispatched_qty: numCell(r['dispatched_qty']),
        invoiced_qty: numCell(r['invoiced_qty']),
        to_invoice_qty: numCell(r['to_invoice_qty']),
        rate: numCell(r['rate']),
        to_invoice_value: numCell(r['to_invoice_value']),
        last_dispatch_date: last,
        days_since_dispatch:
          r['days_since_dispatch'] == null ? null : numCell(r['days_since_dispatch']),
      };
    });

    return { columns: dispatchedNotInvoicedReport.definition.columns, rows };
  },
};
