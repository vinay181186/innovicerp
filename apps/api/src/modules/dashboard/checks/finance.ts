// ADR-264 phase 2 — Finance checks.
//   fin_jw_not_invoiced — one row per JWSO line whose returned qty is ahead of
//                         its JW-invoiced qty: lib/jw-to-invoice.ts
//                         jwLineToInvoiceSql (the JW Invoice create guard's
//                         rule, and the "Dispatched not invoiced" report's).
//                         Same line exclusions as that report (line live, not
//                         cancelled). Date = latest live JW return challan
//                         (jwLineLastReturnDateSql), read as its age.
//   fin_invoice_overdue — SO invoices past their Due Date with money still
//                         owed: lib/invoice-overdue.ts invoiceOverdueSql +
//                         invoiceBalanceSql (GET /invoices' and the invoice-
//                         lines strip's rule) — alone, so the count equals the
//                         Invoices strip's Overdue count. Qty = the
//                         balance in rupees — a money figure, so the check
//                         carries priceForm 'invoice_create' and a caller
//                         without the Price right on Invoices gets qty null.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { invoiceBalanceSql, invoiceOverdueSql } from '../../../lib/invoice-overdue';
import { jwLineLastReturnDateSql, jwLineToInvoiceSql } from '../../../lib/jw-to-invoice';
import type { CheckCtx, CheckDef } from './types';

export function jwNotInvoicedSql(c: CheckCtx): SQL {
  return sql`
    SELECT jwl.id::text AS row_key, jw.id, jw.code, 'jw'::text AS kind,
           t.last_return::text AS doc_date, NULL::text AS due_date,
           t.last_return::text AS sort_key,
           COALESCE(cl.name, jw.customer_name)::text AS party,
           COALESCE(i.code, jwl.item_code_text)::text AS item_code,
           COALESCE(i.name, jwl.part_name)::text AS item_name,
           t.to_invoice::numeric AS qty, jwl.uom::text AS uom, NULL::numeric AS amount,
           jw.created_by::text AS created_by, 0::int AS is_late,
           NULLIF(btrim(jw.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.job_work_order_lines jwl
    JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = jwl.item_id
    LEFT JOIN public.clients cl ON cl.id = jw.client_id AND cl.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT ${jwLineToInvoiceSql('jwl')} AS to_invoice,
                               ${jwLineLastReturnDateSql('jwl')} AS last_return) t
    WHERE jwl.company_id = ${c.cid}::uuid AND jwl.deleted_at IS NULL
      AND jwl.status <> 'cancelled'
      AND t.to_invoice > 0`;
}

export function invoiceOverdueCheckSql(c: CheckCtx): SQL {
  return sql`
    SELECT inv.id::text AS row_key, inv.id, inv.code, 'invoice'::text AS kind,
           inv.invoice_date::text AS doc_date, inv.due_date::text AS due_date,
           inv.due_date::text AS sort_key,
           COALESCE(cl.name, inv.client_name_text)::text AS party,
           NULL::text AS item_code, NULL::text AS item_name,
           b.balance::numeric AS qty, '₹'::text AS uom, NULL::numeric AS amount,
           inv.created_by::text AS created_by,
           -- invoiceOverdueSql already means Due Date before today.
           1::int AS is_late,
           inv.so_code_text::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.invoices inv
    LEFT JOIN public.clients cl ON cl.id = inv.client_id AND cl.deleted_at IS NULL
    CROSS JOIN LATERAL (SELECT ${invoiceBalanceSql('inv')} AS balance) b
    WHERE inv.company_id = ${c.cid}::uuid AND inv.deleted_at IS NULL
      AND ${invoiceOverdueSql(sql`${c.today}::date`, 'inv')}`;
}

export const FINANCE_CHECKS: readonly CheckDef[] = [
  {
    key: 'fin_jw_not_invoiced',
    dept: 'finance',
    label: 'JW returned, not JW-invoiced',
    head: ['JWSO No.', 'Customer', 'Return Date'],
    href: '/invoices?tab=jw',
    query: jwNotInvoicedSql,
    docHref: (r) => docNavPage('job-work-order', r.id),
    dated: false,
  },
  {
    key: 'fin_invoice_overdue',
    dept: 'finance',
    label: 'Invoices overdue for payment',
    head: ['Invoice No.', 'Customer', 'Due Date'],
    href: '/invoices',
    query: invoiceOverdueCheckSql,
    docHref: (r) => docNavPage('invoice', r.id),
    dated: true,
    priceForm: 'invoice_create',
  },
];
