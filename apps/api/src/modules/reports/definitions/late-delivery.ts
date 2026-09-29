// Late delivery (on-time %) — one row per customer dispatch line, compared
// with the Due Date on the SO line it shipped against: Days Late and an
// On Time Yes/No flag the user can count for an on-time %.
// Modelled on ERPNext's "Delayed Order Report" / delivery on-time analysis.

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

export const lateDeliveryReport: RegisteredReport = {
  definition: {
    slug: 'late-delivery',
    title: 'Late delivery (on-time %)',
    description:
      'Every dispatch line (cancelled dispatches left out) against its SO line Due Date: Days Late (Dispatch Date minus Due Date, 0 when on time) and On Time Yes/No. Blank when the SO line has no Due Date. Newest dispatch first.',
    group: 'Sales',
    dept: 'sales',
    filters: [
      { key: 'fromDate', label: 'Dispatch Date From', kind: 'date' },
      { key: 'toDate', label: 'Dispatch Date To', kind: 'date' },
      { key: 'customer', label: 'Customer', kind: 'text', placeholder: 'Customer name' },
    ],
    columns: [
      { key: 'dispatch_code', label: 'Dispatch No.', type: 'text' },
      { key: 'dispatch_date', label: 'Dispatch Date', type: 'date' },
      { key: 'client_name', label: 'Customer', type: 'text' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_revision', label: 'Drawing Rev', type: 'text' },
      { key: 'qty', label: 'Dispatch Qty', type: 'number' },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'days_late', label: 'Days Late', type: 'number' },
      { key: 'on_time', label: 'On Time', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const customer = likeFilter(filters['customer']);

    const fromFrag = fromDate ? sql`AND cd.dispatch_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND cd.dispatch_date <= ${toDate}::date` : sql``;
    const customerFrag = customer
      ? sql`AND COALESCE(cl.name, so.customer_name, cd.customer_text, '') ILIKE ${customer}`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        cd.code                                             AS dispatch_code,
        cd.dispatch_date::text                              AS dispatch_date,
        COALESCE(cl.name, so.customer_name, cd.customer_text, '—') AS client_name,
        COALESCE(so.code, cd.so_code_text)                  AS so_code,
        sol.client_po_line_no                               AS client_po_line_no,
        COALESCE(it.code, cdl.item_code_text, sol.item_code_text) AS item_code,
        sol.revision::text                                  AS item_revision,
        cdl.qty                                             AS qty,
        sol.due_date::text                                  AS due_date,
        CASE WHEN sol.due_date IS NULL THEN NULL
             ELSE GREATEST(cd.dispatch_date - sol.due_date, 0)
        END                                                 AS days_late,
        CASE WHEN sol.due_date IS NULL THEN NULL
             WHEN cd.dispatch_date <= sol.due_date THEN 'Yes'
             ELSE 'No'
        END                                                 AS on_time
      FROM public.customer_dispatch_lines cdl
      JOIN public.customer_dispatches cd
        ON cd.id = cdl.customer_dispatch_id AND cd.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = cdl.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = cd.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.clients cl
        ON cl.id = so.client_id AND cl.deleted_at IS NULL
      LEFT JOIN public.items it
        ON it.id = COALESCE(cdl.item_id, sol.item_id) AND it.deleted_at IS NULL
      WHERE cdl.company_id = ${companyId}::uuid
        AND cdl.deleted_at IS NULL
        AND cd.status <> 'cancelled'
        ${fromFrag}
        ${toFrag}
        ${customerFrag}
      ORDER BY cd.dispatch_date DESC, cd.code DESC, cdl.line_no
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      dispatch_code: String(r['dispatch_code'] ?? ''),
      dispatch_date: dateCell(r['dispatch_date']),
      client_name: String(r['client_name'] ?? ''),
      so_code: textCell(r['so_code']),
      client_po_line_no: textCell(r['client_po_line_no']),
      item_code: String(r['item_code'] ?? '—'),
      item_revision: textCell(r['item_revision']),
      qty: numCell(r['qty']),
      due_date: dateCell(r['due_date']),
      days_late: r['days_late'] == null ? null : numCell(r['days_late']),
      on_time: textCell(r['on_time']),
    }));

    return { columns: lateDeliveryReport.definition.columns, rows };
  },
};
