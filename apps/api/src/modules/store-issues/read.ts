// Item Issue reads — ADR-193 phase 3b. Register list (slip headers with an
// items summary) and one slip with its lines. Pre-0157 slips carry one
// backfilled line, so they read exactly like new ones.

import type {
  IssueAgainst,
  ListStoreIssuesQuery,
  ListStoreIssuesResponse,
  StoreIssueDetail,
  StoreIssueLine,
  StoreIssueListItem,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { createdByNameSql } from '../../lib/created-by-sql';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { itemsSummaryOf, slipSummaryLateral } from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';
import { newestFirst } from '../../lib/list-order';
import { STORE_ISSUE_SF_COLUMNS } from './sf-columns';

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// ADR-303 — one row per slip. Every join and lateral the list's columns, its
// search and its Sort & Filter read lives in HEADER_FROM (the page); the count
// takes the parts its WHERE needs (pagination counts slips).
//   oso / ojw — the ORDER the slip traces to (the line register's chain,
//               lines.ts): the slip's own SO (Assembly SO), else the Job Card's
//               source SO line's SO, else its source JWSO. `so` stays the
//               slip's own Assembly SO (salesOrderCode), unchanged for callers.
//   lq        — Issue Qty = sum of the slip's live lines.
// HEADER_JOINS are single-row FK lookups; HEADER_LATERALS aggregate the
// slip's lines. The count adds each only when the search / a filter reads it.
const HEADER_JOINS = sql`
  LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id
  LEFT JOIN public.sales_orders so ON so.id = si.sales_order_id
  LEFT JOIN public.sales_order_lines osol ON osol.id = jc.source_so_line_id
  LEFT JOIN public.job_work_order_lines ojwl ON ojwl.id = jc.source_jw_line_id
  LEFT JOIN public.sales_orders oso ON oso.id = COALESCE(si.sales_order_id, osol.sales_order_id)
  LEFT JOIN public.job_work_orders ojw ON ojw.id = ojwl.job_work_order_id
  LEFT JOIN public.users u ON u.id = si.created_by`;
const HEADER_LATERALS = sql`
  ${slipSummaryLateral}
  LEFT JOIN LATERAL (
    SELECT SUM(l.qty) AS total_qty
    FROM public.store_issue_lines l
    WHERE l.issue_id = si.id AND l.deleted_at IS NULL
  ) lq ON true`;
const HEADER_FROM = sql`
  FROM public.store_issues si
  ${HEADER_JOINS}
  ${HEADER_LATERALS}`;

const HEADER_SELECT = sql`
  SELECT
    si.id, si.code, si.issue_date, si.issue_against,
    si.job_card_id, jc.code AS job_card_code,
    si.sales_order_id, so.code AS sales_order_code,
    so.internal_so_no AS sales_order_internal_no,
    COALESCE(oso.code, ojw.code) AS so_code,
    oso.internal_so_no AS so_internal_no,
    si.issued_to_operator_id, si.issued_to, si.department,
    si.purpose, si.remarks, si.ref_type, si.ref_no,
    si.item_code_text AS legacy_code, si.qty AS legacy_qty,
    ls.line_count, ls.first_line, lq.total_qty,
    u.full_name AS issued_by_name,
    ${createdByNameSql(sql`si.created_by`)} AS created_by_name,
    si.reversed_at, si.reversal_reason,
    si.created_at, si.created_by
  ${HEADER_FROM}`;

function toListItem(r: Record<string, unknown>): StoreIssueListItem {
  const lineCount = Number(r['line_count'] ?? 0);
  return {
    id: String(r['id']),
    code: String(r['code']),
    issueDate: dateLike(r['issue_date']),
    issueAgainst: (r['issue_against'] as IssueAgainst | null) ?? 'general',
    jobCardId: (r['job_card_id'] as string | null) ?? null,
    jobCardCode: (r['job_card_code'] as string | null) ?? null,
    salesOrderId: (r['sales_order_id'] as string | null) ?? null,
    salesOrderCode: (r['sales_order_code'] as string | null) ?? null,
    salesOrderInternalNo: (r['sales_order_internal_no'] as string | null) ?? null,
    operatorId: (r['issued_to_operator_id'] as string | null) ?? null,
    issuedTo: String(r['issued_to'] ?? ''),
    department: (r['department'] as string | null) ?? null,
    legacyReference: r['ref_no']
      ? `${String(r['ref_type'] ?? '')} ${String(r['ref_no'])}`.trim()
      : null,
    purpose: (r['purpose'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    lineCount: lineCount > 0 ? lineCount : r['legacy_code'] ? 1 : 0,
    itemsSummary: itemsSummaryOf(r),
    issuedByName: (r['issued_by_name'] as string | null) ?? null,
    reversedAt: r['reversed_at'] != null ? tsLike(r['reversed_at']) : null,
    reversalReason: (r['reversal_reason'] as string | null) ?? null,
    createdAt: tsLike(r['created_at']),
    createdBy: String(r['created_by']),
    soCode: (r['so_code'] as string | null) ?? null,
    soInternalNo: (r['so_internal_no'] as string | null) ?? null,
    totalQty: roundQty(
      Number(lineCount > 0 ? (r['total_qty'] ?? 0) : r['legacy_code'] ? (r['legacy_qty'] ?? 0) : 0),
    ),
    createdByName: (r['created_by_name'] as string | null) ?? null,
  };
}

export async function listStoreIssues(
  input: ListStoreIssuesQuery,
  user: AuthContext,
): Promise<ListStoreIssuesResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Universal search: the slip's own fields, its order (SO / JWSO), and an
    // item code or name on ANY of its lines (EXISTS — the slip stays one row).
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          si.code ILIKE ${term} ESCAPE '\\'
          OR si.issued_to ILIKE ${term} ESCAPE '\\'
          OR si.purpose ILIKE ${term} ESCAPE '\\'
          OR jc.code ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR oso.code ILIKE ${term} ESCAPE '\\'
          OR oso.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR ojw.code ILIKE ${term} ESCAPE '\\'
          OR si.item_code_text ILIKE ${term} ESCAPE '\\'
          OR EXISTS (
            SELECT 1 FROM public.store_issue_lines sl
            LEFT JOIN public.items sli ON sli.id = sl.item_id
            WHERE sl.issue_id = si.id AND sl.deleted_at IS NULL
              AND (sl.item_code_text ILIKE ${term} ESCAPE '\\'
                   OR sli.code ILIKE ${term} ESCAPE '\\'
                   OR sli.name ILIKE ${term} ESCAPE '\\')
          )
        )`
      : sql``;
    const itemFrag = input.itemId
      ? sql`AND EXISTS (
          SELECT 1 FROM public.store_issue_lines sl
          WHERE sl.issue_id = si.id AND sl.deleted_at IS NULL
            AND sl.item_id = ${input.itemId}::uuid
        )`
      : sql``;
    const jcFrag = input.jobCardId ? sql`AND si.job_card_id = ${input.jobCardId}::uuid` : sql``;
    const soFrag = input.salesOrderId
      ? sql`AND si.sales_order_id = ${input.salesOrderId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND si.issue_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND si.issue_date <= ${input.toDate}::date` : sql``;
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(STORE_ISSUE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(STORE_ISSUE_SF_COLUMNS, sf, newestFirst('si'));
    const where = sql`
      WHERE si.company_id = ${companyId}::uuid
        AND si.deleted_at IS NULL
        ${searchFrag} ${itemFrag} ${jcFrag} ${soFrag} ${fromFrag} ${toFrag} ${sfFrag}`;

    const rows = (await tx.execute(sql`
      ${HEADER_SELECT}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    // The pager total counts SLIPS under the SAME WHERE as the page. It joins
    // only what that WHERE reads: the FK joins for the search / a ▾ filter,
    // the line laterals (ls, lq) for a ▾ filter (Lines, Issue Qty, Items).
    // Each is one row per slip, so none changes the count.
    const filtering = (sf?.filters.length ?? 0) > 0;
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.store_issues si
      ${term || filtering ? HEADER_JOINS : sql``}
      ${filtering ? HEADER_LATERALS : sql``}
      ${where}
    `)) as unknown as Array<{ total: number }>;

    return {
      items: rows.map(toListItem),
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}

/** One slip with its lines — for callers already inside a transaction. */
export async function readStoreIssueDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<StoreIssueDetail> {
  const heads = (await tx.execute(sql`
    ${HEADER_SELECT}
    WHERE si.id = ${id}::uuid AND si.company_id = ${companyId}::uuid AND si.deleted_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  const head = heads[0];
  if (!head) throw new NotFoundError('Item Issue not found.');

  const lineRows = (await tx.execute(sql`
    SELECT l.id, l.line_no, l.item_id,
           COALESCE(i.code, l.item_code_text) AS item_code,
           i.name AS item_name, i.uom::text AS uom,
           l.qty, l.store_transaction_id,
           COALESCE((
             SELECT SUM(r.qty) FROM public.store_issue_returns r
             WHERE r.issue_line_id = l.id AND r.deleted_at IS NULL
           ), 0) AS returned_qty
    FROM public.store_issue_lines l
    LEFT JOIN public.items i ON i.id = l.item_id
    WHERE l.issue_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY l.line_no
  `)) as unknown as Array<Record<string, unknown>>;

  const lines: StoreIssueLine[] = lineRows.map((r) => ({
    id: String(r['id']),
    lineNo: Number(r['line_no']),
    itemId: String(r['item_id']),
    itemCode: String(r['item_code'] ?? ''),
    itemName: (r['item_name'] as string | null) ?? null,
    uom: (r['uom'] as string | null) ?? null,
    qty: roundQty(Number(r['qty'] ?? 0)),
    returnedQty: roundQty(Number(r['returned_qty'] ?? 0)),
    storeTransactionId: (r['store_transaction_id'] as string | null) ?? null,
  }));
  return { ...toListItem(head), lines };
}

export async function getStoreIssue(id: string, user: AuthContext): Promise<StoreIssueDetail> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => readStoreIssueDetail(tx, companyId, id));
}
