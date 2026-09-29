// Dispatched but not invoiced — SO lines whose dispatched qty is ahead of the
// invoiced qty, plus JWSO lines whose returned qty is ahead of the JW-invoiced
// qty: the qty and value still to invoice, and how long since it shipped.
// Modelled on ERPNext's "Delivered Items To Be Billed" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { dateCell, likeFilter, numCell, type SqlRow, textCell } from './report-helpers';

export const dispatchedNotInvoicedReport: RegisteredReport = {
  definition: {
    slug: 'dispatched-not-invoiced',
    title: 'Dispatched but not invoiced',
    description:
      'SO lines with Dispatched (cancelled dispatches left out) more than Invoiced, and JWSO lines with Returned more than Invoiced. To Invoice Value = To Invoice × line Rate. Oldest shipment first.',
    group: 'Finance',
    dept: 'finance',
    showsMoney: true,
    filters: [{ key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' }],
    columns: [
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'order_code', label: 'SO / JWSO', type: 'text' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
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
        u.source, u.order_code, u.client_name, u.client_po_line_no, u.item_code,
        u.item_revision, u.dispatched_qty, u.invoiced_qty, u.to_invoice_qty, u.rate,
        u.to_invoice_value,
        u.last_dispatch_date::text               AS last_dispatch_text,
        (CURRENT_DATE - u.last_dispatch_date)    AS days_since_dispatch
      FROM (
        SELECT
          'SO'                                         AS source,
          so.code                                      AS order_code,
          COALESCE(cl.name, so.customer_name, '—')     AS client_name,
          sol.client_po_line_no                        AS client_po_line_no,
          COALESCE(it.code, sol.item_code_text)   AS item_code,
          sol.revision::text                           AS item_revision,
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
          jwo.code                                     AS order_code,
          COALESCE(cl.name, jwo.customer_name, '—')    AS client_name,
          NULL::text                                   AS client_po_line_no,
          COALESCE(it.code, jwl.item_code_text)   AS item_code,
          jwl.revision::text                           AS item_revision,
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
      ORDER BY u.last_dispatch_date ASC NULLS LAST, u.order_code, u.line_no
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => {
      const last = dateCell(r['last_dispatch_text']);
      return {
        source: String(r['source'] ?? ''),
        order_code: String(r['order_code'] ?? ''),
        client_name: String(r['client_name'] ?? ''),
        client_po_line_no: textCell(r['client_po_line_no']),
        item_code: String(r['item_code'] ?? '—'),
        item_revision: textCell(r['item_revision']),
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
