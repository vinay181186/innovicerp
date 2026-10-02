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
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { itemsSummaryOf, slipSummaryLateral } from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';
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

const HEADER_SELECT = sql`
  SELECT
    si.id, si.code, si.issue_date, si.issue_against,
    si.job_card_id, jc.code AS job_card_code,
    si.sales_order_id, so.code AS sales_order_code,
    si.issued_to_operator_id, si.issued_to, si.department,
    si.purpose, si.remarks, si.ref_type, si.ref_no,
    si.item_code_text AS legacy_code, si.qty AS legacy_qty,
    ls.line_count, ls.first_line,
    u.full_name AS issued_by_name,
    si.reversed_at, si.reversal_reason,
    si.created_at, si.created_by
  FROM public.store_issues si
  LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id
  LEFT JOIN public.sales_orders so ON so.id = si.sales_order_id
  LEFT JOIN public.users u ON u.id = si.created_by
  ${slipSummaryLateral}`;

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
  };
}

export async function listStoreIssues(
  input: ListStoreIssuesQuery,
  user: AuthContext,
): Promise<ListStoreIssuesResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          si.code ILIKE ${term}
          OR si.issued_to ILIKE ${term}
          OR si.purpose ILIKE ${term}
          OR jc.code ILIKE ${term}
          OR so.code ILIKE ${term}
          OR si.item_code_text ILIKE ${term}
          OR EXISTS (
            SELECT 1 FROM public.store_issue_lines sl
            LEFT JOIN public.items sli ON sli.id = sl.item_id
            WHERE sl.issue_id = si.id AND sl.deleted_at IS NULL
              AND (sl.item_code_text ILIKE ${term} OR sli.code ILIKE ${term})
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
    const orderBy = sfOrderBy(STORE_ISSUE_SF_COLUMNS, sf, sql`si.issue_date DESC, si.code DESC`);
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

    // The pager total counts under the SAME filters (and joins) as the page —
    // the users join included, since the Issued By filter reads u.full_name.
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.store_issues si
      LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id
      LEFT JOIN public.sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN public.users u ON u.id = si.created_by
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
