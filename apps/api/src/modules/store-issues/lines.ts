// ADR-261 — the Item Issue Register, one row per issue LINE
// (GET /store-issues/lines). Same query params, guard, company scope and
// envelope as listStoreIssues (read.ts); that slip list is left unchanged for
// its other callers. Paginates on lines. Every slip has lines (pre-0157 slips
// carry one backfilled line), so no slip drops off the register.
//
// SO link: the slip's own SO (Assembly SO issue), else the Job Card's source
// SO line's SO, else its source JWSO (code only). POL is known only through the
// Job Card's SO / JWSO line (polSql). The order line's rev is shown only when
// the issued item IS that line's item — an RM issued to a JC never wears the
// part's rev.

import type {
  ListStoreIssueLinesResponse,
  ListStoreIssuesQuery,
  StoreIssueLineRow,
  IssueAgainst,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { day, iso } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { polSql } from '../../lib/pol';
import { roundQty } from '../../lib/stock-ledger';
import { requireCompany } from './read';
import { STORE_ISSUE_LINE_SF_COLUMNS } from './sf-columns';

const LINE_FROM = sql`
  FROM public.store_issue_lines l
  JOIN public.store_issues si ON si.id = l.issue_id AND si.deleted_at IS NULL
  LEFT JOIN public.items i ON i.id = l.item_id
  LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id
  LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
  LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
  LEFT JOIN public.sales_orders so ON so.id = COALESCE(si.sales_order_id, sol.sales_order_id)
  LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
  LEFT JOIN public.users u ON u.id = si.created_by`;

function toRow(r: Record<string, unknown>): StoreIssueLineRow {
  const s = (k: string): string | null => (r[k] as string | null) ?? null;
  return {
    lineId: String(r['line_id']),
    docId: String(r['doc_id']),
    docCode: String(r['doc_code']),
    docDate: day(r['doc_date']),
    issueAgainst: (r['issue_against'] as IssueAgainst | null) ?? 'general',
    jobCardCode: s('job_card_code'),
    salesOrderCode: s('sales_order_code'),
    department: s('department'),
    legacyReference: r['ref_no']
      ? `${String(r['ref_type'] ?? '')} ${String(r['ref_no'])}`.trim()
      : null,
    soCode: s('so_code'),
    soInternalNo: s('so_internal_no'),
    clientPoLineNo: s('client_po_line_no'),
    createdAt: iso(r['created_at']),
    itemCode: String(r['item_code'] ?? ''),
    itemRevision: s('item_revision'),
    itemName: s('item_name'),
    uom: s('uom'),
    qty: roundQty(Number(r['qty'] ?? 0)),
    issuedTo: String(r['issued_to'] ?? ''),
    purpose: s('purpose'),
    issuedByName: s('issued_by_name'),
    reversedAt: r['reversed_at'] != null ? iso(r['reversed_at']) : null,
    reversalReason: s('reversal_reason'),
  };
}

export async function listStoreIssueLines(
  input: ListStoreIssuesQuery,
  user: AuthContext,
): Promise<ListStoreIssueLinesResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          si.code ILIKE ${term} ESCAPE '\\'
          OR si.issued_to ILIKE ${term} ESCAPE '\\'
          OR si.purpose ILIKE ${term} ESCAPE '\\'
          OR jc.code ILIKE ${term} ESCAPE '\\'
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR so.internal_so_no ILIKE ${term} ESCAPE '\\'
          OR jw.code ILIKE ${term} ESCAPE '\\'
          OR l.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const itemFrag = input.itemId ? sql`AND l.item_id = ${input.itemId}::uuid` : sql``;
    const jcFrag = input.jobCardId ? sql`AND si.job_card_id = ${input.jobCardId}::uuid` : sql``;
    const soFrag = input.salesOrderId
      ? sql`AND si.sales_order_id = ${input.salesOrderId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND si.issue_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND si.issue_date <= ${input.toDate}::date` : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(STORE_ISSUE_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      STORE_ISSUE_LINE_SF_COLUMNS,
      sf,
      sql`si.issue_date DESC, si.code DESC, l.line_no`,
    );
    const where = sql`
      WHERE l.company_id = ${companyId}::uuid
        AND si.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        ${searchFrag} ${itemFrag} ${jcFrag} ${soFrag} ${fromFrag} ${toFrag} ${sfFrag}`;

    const rows = (await tx.execute(sql`
      SELECT
        l.id AS line_id, si.id AS doc_id, si.code AS doc_code, si.issue_date AS doc_date,
        si.issue_against, jc.code AS job_card_code,
        CASE WHEN si.sales_order_id IS NOT NULL THEN so.code END AS sales_order_code,
        si.department, si.ref_type, si.ref_no,
        COALESCE(so.code, jw.code) AS so_code,
        so.internal_so_no AS so_internal_no,
        ${polSql('sol', 'jwl')} AS client_po_line_no,
        COALESCE(l.created_at, si.created_at) AS created_at,
        COALESCE(i.code, l.item_code_text) AS item_code,
        CASE
          WHEN sol.item_id IS NOT NULL AND sol.item_id = l.item_id THEN sol.revision::text
          WHEN jwl.item_id IS NOT NULL AND jwl.item_id = l.item_id THEN jwl.revision::text
        END AS item_revision,
        i.name AS item_name, i.uom::text AS uom, l.qty,
        si.issued_to, si.purpose, u.full_name AS issued_by_name,
        si.reversed_at, si.reversal_reason
      ${LINE_FROM}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      ${LINE_FROM}
      ${where}
    `)) as unknown as Array<{ total: number }>;

    return {
      items: rows.map(toRow),
      total: Number(totalRows[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
    };
  });
}
