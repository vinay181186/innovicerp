// Tool Issue reads (ADR-193 phase 4b): register list with summary tiles, one
// issue with its instruments and returns, and who holds what.

import type {
  InstrumentReturnCondition,
  ListToolIssuesQuery,
  ListToolIssuesResponse,
  ToolHolderRow,
  ToolIssueDetail,
  ToolIssueInstrumentRow,
  ToolIssueReturnRow,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { roundQty } from '../../lib/stock-ledger';
import { dateOut, tsOut } from '../instruments/common';
import { ISSUE_SELECT, readIssue, requireCompany, todayIst, toListItem } from './common';
import { TOOL_ISSUE_SF_COLUMNS } from './sf-columns';

const OUT = sql`x.return_status IN ('issued', 'partial')`;

export async function listToolIssues(
  input: ListToolIssuesQuery,
  user: AuthContext,
): Promise<ListToolIssuesResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  const today = todayIst();
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (x.code ILIKE ${term} OR x.item_code ILIKE ${term} OR x.item_name ILIKE ${term}
             OR x.issued_to ILIKE ${term} OR x.purpose ILIKE ${term}
             OR x.job_card_code ILIKE ${term} OR x.serial_nos ILIKE ${term})`
      : sql``;
    const overdue = sql`${OUT} AND x.still_out_qty > 0 AND x.expected_return_date < ${today}::date`;
    const filterFrag =
      input.filter === 'out'
        ? sql`AND ${OUT}`
        : input.filter === 'overdue'
          ? sql`AND ${overdue}`
          : input.filter === 'returned'
            ? sql`AND x.return_status = 'returned'`
            : input.filter === 'cancelled'
              ? sql`AND x.return_status = 'cancelled'`
              : sql``;
    const base = sql`(
      ${ISSUE_SELECT}
      WHERE ti.company_id = ${companyId}::uuid AND ti.deleted_at IS NULL
    ) x`;
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to list AND count;
    // the summary tiles stay whole-company, as before.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(TOOL_ISSUE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(TOOL_ISSUE_SF_COLUMNS, sf, sql`x.issue_date DESC, x.code DESC`);

    const rows = (await tx.execute(sql`
      SELECT x.* FROM ${base}
      WHERE true ${searchFrag} ${filterFrag} ${sfFrag}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totals = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM ${base} WHERE true ${searchFrag} ${filterFrag} ${sfFrag}
    `)) as unknown as Array<{ total: number }>;
    // Tiles count every live issue of the company (not the search / filter).
    const sums = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE ${OUT})::int AS out,
             COUNT(*) FILTER (WHERE x.return_status = 'returned')::int AS returned,
             COUNT(*) FILTER (WHERE ${overdue})::int AS overdue,
             (SELECT COUNT(*)::int FROM public.tool_writeoffs w
              WHERE w.company_id = ${companyId}::uuid AND w.status = 'pending'
                AND w.deleted_at IS NULL) AS writeoffs_pending
      FROM ${base}
    `)) as unknown as Array<Record<string, unknown>>;
    const s = sums[0] ?? {};
    return {
      items: rows.map((r) => toListItem(r, today)),
      total: Number(totals[0]?.total ?? 0),
      limit: input.limit,
      offset: input.offset,
      summary: {
        total: Number(s['total'] ?? 0),
        out: Number(s['out'] ?? 0),
        returned: Number(s['returned'] ?? 0),
        overdue: Number(s['overdue'] ?? 0),
        writeoffsPending: Number(s['writeoffs_pending'] ?? 0),
      },
    };
  });
}

/** One issue with instruments and return rows (inside a transaction). */
export async function readToolIssueDetail(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<ToolIssueDetail> {
  const head = await readIssue(tx, companyId, id);
  const insRows = (await tx.execute(sql`
    SELECT l.instrument_id, ins.serial_no, l.returned_on, l.return_condition
    FROM public.tool_issue_instruments l
    JOIN public.instruments ins ON ins.id = l.instrument_id
    WHERE l.tool_issue_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY lower(ins.serial_no)
  `)) as unknown as Array<Record<string, unknown>>;
  const instruments: ToolIssueInstrumentRow[] = insRows.map((r) => ({
    instrumentId: String(r['instrument_id']),
    serialNo: String(r['serial_no']),
    returnedOn: dateOut(r['returned_on']),
    returnCondition: (r['return_condition'] as InstrumentReturnCondition | null) ?? null,
  }));
  const retRows = (await tx.execute(sql`
    SELECT r.id, r.return_date, r.good_qty, r.damaged_qty, r.lost_qty, r.consumed_qty,
           r.reason, u.full_name AS recorded_by_name, r.created_at
    FROM public.tool_issue_returns r
    LEFT JOIN public.users u ON u.id = r.created_by
    WHERE r.tool_issue_id = ${id}::uuid AND r.company_id = ${companyId}::uuid
      AND r.deleted_at IS NULL
    ORDER BY r.return_date, r.created_at
  `)) as unknown as Array<Record<string, unknown>>;
  const returns: ToolIssueReturnRow[] = retRows.map((r) => ({
    id: String(r['id']),
    returnDate: dateOut(r['return_date']) ?? '',
    goodQty: roundQty(Number(r['good_qty'] ?? 0)),
    damagedQty: roundQty(Number(r['damaged_qty'] ?? 0)),
    lostQty: roundQty(Number(r['lost_qty'] ?? 0)),
    consumedQty: roundQty(Number(r['consumed_qty'] ?? 0)),
    reason: (r['reason'] as string | null) ?? null,
    recordedByName: (r['recorded_by_name'] as string | null) ?? null,
    createdAt: tsOut(r['created_at']),
  }));
  return { ...head, instruments, returns };
}

export async function getToolIssue(id: string, user: AuthContext): Promise<ToolIssueDetail> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => readToolIssueDetail(tx, companyId, id));
}

/** Who holds what: every open issue with something still out. */
export async function listToolHolders(user: AuthContext): Promise<ToolHolderRow[]> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  const today = todayIst();
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT x.* FROM (
        ${ISSUE_SELECT}
        WHERE ti.company_id = ${companyId}::uuid AND ti.deleted_at IS NULL
      ) x
      WHERE ${OUT} AND x.still_out_qty > 0
      ORDER BY x.issued_to, x.expected_return_date NULLS LAST, x.code
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const t = toListItem(r, today);
      return {
        holder: t.issuedTo,
        operatorId: t.operatorId,
        itemCode: t.itemCode ?? '',
        itemName: t.itemName,
        toolIssueId: t.id,
        toolIssueCode: t.code,
        stillOutQty: t.stillOutQty,
        // Serial tools: only the instruments not yet back.
        serialNos: (r['out_serial_nos'] as string | null) ?? null,
        expectedReturnDate: t.expectedReturnDate,
        isOverdue: t.isOverdue,
      };
    });
  });
}
