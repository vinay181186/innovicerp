// SO line analysis — one row per Sales Order line (open and closed) with how
// much has been dispatched and invoiced against it, what is still to dispatch
// and to bill, and how late the undelivered balance is.
// Modelled on ERPNext's "Sales Order Analysis" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  dateCell,
  enumFilter,
  isoDateFilter,
  likeFilter,
  numCell,
  type SqlRow,
  textCell,
} from './report-helpers';

const STATUSES = ['open', 'closed', 'dispatched'] as const;

export const soLineAnalysisReport: RegisteredReport = {
  definition: {
    slug: 'so-line-analysis',
    title: 'SO line analysis',
    description:
      'Every SO line (Draft and Cancelled left out) with Dispatched, To Dispatch, Invoiced and To Invoice qty, Value Not Invoiced ((Order Qty − Invoiced) × Rate on an open line; To Invoice × Rate on a closed or dispatched line), and Days Late past the Due Date while qty is still to dispatch.',
    group: 'Sales',
    dept: 'sales',
    showsMoney: true,
    filters: [
      { key: 'fromDate', label: 'SO Date From', kind: 'date' },
      { key: 'toDate', label: 'SO Date To', kind: 'date' },
      { key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' },
      { key: 'status', label: 'SO Line Status', kind: 'enum', options: [...STATUSES] },
      { key: 'onlyPending', label: 'Only Pending', kind: 'enum', options: ['yes', 'no'] },
    ],
    columns: [
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_date', label: 'SO Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'line_status', label: 'SO Line Status', type: 'text' },
      { key: 'order_qty', label: 'Order Qty', type: 'number' },
      { key: 'dispatched_qty', label: 'Dispatched', type: 'number' },
      { key: 'to_dispatch_qty', label: 'To Dispatch', type: 'number' },
      { key: 'invoiced_qty', label: 'Invoiced', type: 'number' },
      { key: 'to_bill_qty', label: 'To Invoice', type: 'number' },
      { key: 'rate', label: 'Rate', type: 'number' },
      { key: 'value_not_invoiced', label: 'Value Not Invoiced', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_late', label: 'Days Late', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const customer = likeFilter(filters['customer']);
    const status = enumFilter(filters['status'], STATUSES);
    const onlyPending = filters['onlyPending'] === 'yes';

    const fromFrag = fromDate ? sql`AND so.so_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND so.so_date <= ${toDate}::date` : sql``;
    const customerFrag = customer
      ? sql`AND COALESCE(cl.name, so.customer_name, '') ILIKE ${customer}`
      : sql``;
    const statusFrag = status
      ? sql`AND sol.status = ${status}::so_status`
      : sql`AND sol.status IN ('open', 'closed', 'dispatched')`;
    const pendingFrag = onlyPending
      ? sql`AND (q.dispatched < sol.order_qty OR q.dispatched > q.invoiced)`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        so.code                                    AS so_code,
        so.so_date::text                           AS so_date,
        COALESCE(cl.name, so.customer_name, '—')   AS client_name,
        sol.client_po_line_no                      AS client_po_line_no,
        COALESCE(it.code, sol.item_code_text) AS item_code,
        sol.revision::text                         AS item_revision,
        COALESCE(it.name, sol.part_name)           AS item_name,
        sol.status::text                           AS line_status,
        sol.order_qty                              AS order_qty,
        q.dispatched                               AS dispatched_qty,
        GREATEST(sol.order_qty - q.dispatched, 0)  AS to_dispatch_qty,
        q.invoiced                                 AS invoiced_qty,
        GREATEST(q.dispatched - q.invoiced, 0)     AS to_bill_qty,
        sol.rate                                   AS rate,
        -- An open line may still dispatch its whole balance, so everything not
        -- yet invoiced counts. A closed / dispatched line will ship nothing
        -- more: only what went out and is not billed (To Invoice) is left.
        (CASE
           WHEN sol.status = 'open' THEN GREATEST(sol.order_qty - q.invoiced, 0)
           ELSE GREATEST(q.dispatched - q.invoiced, 0)
         END * sol.rate)::numeric(14, 2)         AS value_not_invoiced,
        sol.due_date::text                         AS due_date,
        CASE
          WHEN sol.order_qty - q.dispatched > 0 AND sol.due_date < CURRENT_DATE
            THEN (CURRENT_DATE - sol.due_date)
          ELSE 0
        END::int                                   AS days_late
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.items it
        ON it.id = sol.item_id AND it.deleted_at IS NULL
      LEFT JOIN public.clients cl
        ON cl.id = so.client_id AND cl.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT
          COALESCE((
            SELECT SUM(cdl.qty)
            FROM public.customer_dispatch_lines cdl
            JOIN public.customer_dispatches cd
              ON cd.id = cdl.customer_dispatch_id AND cd.deleted_at IS NULL
            WHERE cdl.sales_order_line_id = sol.id
              AND cdl.deleted_at IS NULL
              AND cd.status <> 'cancelled'
          ), 0)::int AS dispatched,
          COALESCE((
            SELECT SUM(il.qty)
            FROM public.invoice_lines il
            JOIN public.invoices inv
              ON inv.id = il.invoice_id AND inv.deleted_at IS NULL
            WHERE il.sales_order_line_id = sol.id
              AND il.deleted_at IS NULL
          ), 0)::int AS invoiced
      ) q
      WHERE sol.company_id = ${companyId}::uuid
        AND sol.deleted_at IS NULL
        AND so.status NOT IN ('draft', 'cancelled')
        ${statusFrag}
        ${fromFrag}
        ${toFrag}
        ${customerFrag}
        ${pendingFrag}
      ORDER BY so.so_date DESC, so.code DESC, sol.line_no
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      so_code: String(r['so_code'] ?? ''),
      so_date: dateCell(r['so_date']),
      client_name: String(r['client_name'] ?? ''),
      client_po_line_no: textCell(r['client_po_line_no']),
      item_code: String(r['item_code'] ?? '—'),
      item_revision: textCell(r['item_revision']),
      item_name: textCell(r['item_name']),
      line_status: String(r['line_status'] ?? ''),
      order_qty: numCell(r['order_qty']),
      dispatched_qty: numCell(r['dispatched_qty']),
      to_dispatch_qty: numCell(r['to_dispatch_qty']),
      invoiced_qty: numCell(r['invoiced_qty']),
      to_bill_qty: numCell(r['to_bill_qty']),
      rate: numCell(r['rate']),
      value_not_invoiced: numCell(r['value_not_invoiced']),
      due_date: dateCell(r['due_date']),
      days_late: numCell(r['days_late']),
    }));

    return { columns: soLineAnalysisReport.definition.columns, rows };
  },
};
