// ADR-261 — SO Invoices, ONE ROW PER INVOICE LINE (GET /invoices/lines).
//
// Same query params, company scope, price rule and envelope as listInvoices
// (GET /invoices, unchanged — other screens use it), with `rows` of lines in
// place of `invoices`. Paged on LINES. A line is listed when its invoice
// matches the search (every line of it) or the line itself does (item code /
// name / POL). The summary strip counts the INVOICES that have a listed line.
// Code and name are the invoice's frozen snapshot (an invoice is a legal
// document); POL and drawing revision come off the SO line, as on the detail.

import type { ListInvoiceLinesResponse, ListInvoicesQuery } from '@innovic/shared';
import { sql } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { INVOICE_LINE_SF_COLUMNS } from './sf-columns';

const n = (s: string | number | null | undefined): number => Number(s ?? 0) || 0;

type LineRow = {
  line_id: string;
  invoice_id: string;
  invoice_code: string;
  invoice_date: string;
  invoice_status: ListInvoiceLinesResponse['rows'][number]['invoiceStatus'];
  due_date: string | null;
  overdue: boolean;
  client_name: string | null;
  so_code: string | null;
  so_internal_no: string | null;
  client_po_line_no: string | null;
  created_at: string | Date;
  item_code: string | null;
  item_revision: string | null;
  item_name: string;
  qty: number;
  rate: string | null;
  line_amount: string | null;
};

type SummaryRow = {
  total_invoiced: string;
  total_received: string;
  total_tds: string;
  overdue_amount: string;
  overdue_count: number;
  unpaid_count: number;
  partial_count: number;
  paid_count: number;
};

export async function listInvoiceLines(
  input: ListInvoicesQuery,
  user: AuthContext,
): Promise<ListInvoiceLinesResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const showMoney = await canSeeFormPrice(user, 'invoice_create');
  const sfq = readSf(input.sf);
  const sfOpts = { canSeePrice: showMoney };
  const term = input.search?.trim();
  const pat = term ? `%${likeEscape(term)}%` : null;
  const searchFrag = pat
    ? sql`AND (
        invoices.code ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(invoices.so_code_text, '') ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(iso.internal_so_no, '') ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(invoices.client_name_text, '') ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(il.item_code_text, '') ILIKE ${pat} ESCAPE '\\'
        OR il.item_name ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(sol.client_po_line_no, '') ILIKE ${pat} ESCAPE '\\'
      )`
    : sql``;
  // The ONE scope + filter: page, count and summary.
  const fromWhere = sql`
    FROM public.invoice_lines il
    JOIN public.invoices
      ON invoices.id = il.invoice_id AND invoices.deleted_at IS NULL
    LEFT JOIN public.sales_orders iso ON iso.id = invoices.sales_order_id
    LEFT JOIN public.sales_order_lines sol ON sol.id = il.sales_order_line_id
    WHERE il.company_id = ${companyId}::uuid
      AND invoices.company_id = ${companyId}::uuid
      AND il.deleted_at IS NULL
      ${searchFrag}
      ${sfWhere(INVOICE_LINE_SF_COLUMNS, sfq, sfOpts)}`;
  // Newest invoice first (as GET /invoices), lines in line order, id last so
  // a page never skips / repeats a line.
  const order = sfOrderBy(
    INVOICE_LINE_SF_COLUMNS,
    sfq,
    sql`invoices.invoice_date DESC, invoices.created_at DESC, invoices.id DESC, il.line_no ASC, il.id ASC`,
    sfOpts,
  );
  const limitFrag = input.limit !== undefined ? sql`LIMIT ${input.limit}` : sql``;
  // Same overdue rule as GET /invoices (rowToInvoice / its strip); "today" is
  // the India day (Asia/Kolkata), never the UTC one.
  const overdue = sql`(invoices.status <> 'paid' AND invoices.status <> 'cancelled'
    AND invoices.due_date IS NOT NULL
    AND invoices.due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date)`;

  return withUserContext(user, async (tx) => {
    const page = (await tx.execute(sql`
      SELECT il.id::text AS line_id, invoices.id::text AS invoice_id,
        invoices.code AS invoice_code, invoices.invoice_date::text AS invoice_date,
        invoices.status AS invoice_status, invoices.due_date::text AS due_date,
        ${overdue} AS overdue,
        invoices.client_name_text AS client_name, invoices.so_code_text AS so_code,
        iso.internal_so_no AS so_internal_no,
        sol.client_po_line_no,
        COALESCE(il.created_at, invoices.created_at) AS created_at,
        il.item_code_text AS item_code,
        NULLIF(btrim(sol.revision::text), '') AS item_revision,
        il.item_name, il.qty, il.rate::text AS rate, il.line_amount::text AS line_amount
      ${fromWhere}
      ORDER BY ${order}
      ${limitFrag} OFFSET ${input.offset ?? 0}
    `)) as unknown as LineRow[];

    const [cnt] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total ${fromWhere}
    `)) as unknown as Array<{ total: number }>;

    // The strip: the INVOICES with at least one listed line — the same
    // figures GET /invoices computes over its matching invoices.
    const [agg] = (await tx.execute(sql`
      SELECT
        COALESCE(sum(invoices.grand_total), 0)::text AS total_invoiced,
        COALESCE(sum(invoices.total_paid), 0)::text AS total_received,
        COALESCE(sum(invoices.total_tds), 0)::text AS total_tds,
        COALESCE(sum(CASE WHEN ${overdue}
          THEN invoices.grand_total - invoices.total_paid - invoices.total_tds ELSE 0 END), 0)::text
          AS overdue_amount,
        count(*) FILTER (WHERE ${overdue})::int AS overdue_count,
        count(*) FILTER (WHERE invoices.status = 'unpaid')::int AS unpaid_count,
        count(*) FILTER (WHERE invoices.status = 'partial')::int AS partial_count,
        count(*) FILTER (WHERE invoices.status = 'paid')::int AS paid_count
      FROM public.invoices
      WHERE invoices.id IN (SELECT DISTINCT invoices.id ${fromWhere})
    `)) as unknown as SummaryRow[];

    const counts = {
      overdueCount: Number(agg?.overdue_count ?? 0),
      unpaidCount: Number(agg?.unpaid_count ?? 0),
      partialCount: Number(agg?.partial_count ?? 0),
      paidCount: Number(agg?.paid_count ?? 0),
    };
    const rows = page.map((r) => ({
      lineId: r.line_id,
      invoiceId: r.invoice_id,
      invoiceCode: r.invoice_code,
      invoiceDate: r.invoice_date,
      invoiceStatus: r.invoice_status,
      dueDate: r.due_date,
      overdue: r.overdue === true,
      clientName: r.client_name,
      soCode: r.so_code,
      soInternalNo: r.so_internal_no ?? null,
      clientPoLineNo: r.client_po_line_no ?? null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      itemCode: r.item_code,
      itemRevision: r.item_revision ?? null,
      itemName: r.item_name,
      qty: Number(r.qty),
      rate: showMoney ? n(r.rate) : null,
      lineAmount: showMoney ? n(r.line_amount) : null,
    }));
    const total = Number(cnt?.total ?? 0);
    if (!showMoney) {
      return {
        rows,
        total,
        priceVisible: false,
        summary: {
          totalInvoiced: null,
          totalReceived: null,
          outstanding: null,
          overdueAmount: null,
          ...counts,
        },
      };
    }
    const totalInvoiced = n(agg?.total_invoiced);
    const totalReceived = n(agg?.total_received);
    return {
      rows,
      total,
      priceVisible: true,
      summary: {
        totalInvoiced,
        totalReceived,
        outstanding: totalInvoiced - totalReceived - n(agg?.total_tds),
        overdueAmount: n(agg?.overdue_amount),
        ...counts,
      },
    };
  });
}
