// Daily Task Reports service (migration 0051). Mirror of legacy
// renderDailyReports (HTML L14141) + _addDailyReport / _editDailyReport /
// _viewDailyReport. User-submitted "what I did today" reports; each report's
// task lines live in their own rows (daily_report_lines).
//
// DISTINCT from the `daily-report` module (production op-log machine report).

import type {
  DailyTaskReportDetail,
  DailyTaskReportLine,
  DailyTaskReportRow,
  ListDailyTaskReportsQuery,
  ListDailyTaskReportsResponse,
  UpsertDailyTaskReportInput,
} from '@innovic/shared';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { dailyReportLines, dailyReports, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { emitActivityLog } from '../activity-log/service';
import { DTR_SF_COLUMNS, DTR_SHIFT_LABEL } from './sf-columns';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const n = (s: string | number | null): number => Number(s ?? 0) || 0;

// A daily report is the user's own "what I did today". Only an admin or a
// manager reads everyone's; everybody else reads only their own — enforced
// here on list AND detail, not just hidden on the screen.
const canSeeAllReports = (user: AuthContext): boolean =>
  user.role === 'admin' || user.role === 'manager';

async function loadUserNames(tx: DbTransaction, companyId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r.name ?? '']));
}

export type DailyReportFilters = ListDailyTaskReportsQuery;

/**
 * Daily Task Reports list (ADR-201): user / date filters, the search (Report
 * Date as shown, User, Shift) and Sort & Filter all run in SQL; `total` uses
 * the same WHERE; 25-row pages when the screen passes `limit` (no `limit` →
 * every report, as before). Task count + hours are summed per report in SQL.
 */
export async function listDailyReports(
  filters: DailyReportFilters,
  user: AuthContext,
): Promise<ListDailyTaskReportsResponse> {
  const companyId = requireCompany(user);
  const isAdmin = user.role === 'admin';
  const canSeeAll = canSeeAllReports(user);
  const sf = readSf(filters.sf);
  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);

    const conds: SQL[] = [sql`dr.company_id = ${companyId}`, sql`dr.deleted_at IS NULL`];
    if (!canSeeAll) conds.push(sql`dr.user_id = ${user.id}`);
    else if (filters.userId) conds.push(sql`dr.user_id = ${filters.userId}`);
    if (filters.dateFrom) conds.push(sql`dr.report_date >= ${filters.dateFrom}::date`);
    if (filters.dateTo) conds.push(sql`dr.report_date <= ${filters.dateTo}::date`);
    const term = (filters.search ?? '').trim().replace(/\s+/g, ' ');
    if (term) {
      const pat = `%${likeEscape(term)}%`;
      conds.push(sql`(to_char(dr.report_date, 'DD-Mon-YYYY') ILIKE ${pat} ESCAPE '\\'
        OR u.full_name ILIKE ${pat} ESCAPE '\\'
        OR ${DTR_SHIFT_LABEL} ILIKE ${pat} ESCAPE '\\')`);
    }
    const where = sql`${sql.join(conds, sql` AND `)} ${sfWhere(DTR_SF_COLUMNS, sf)}`;
    const order = sfOrderBy(
      DTR_SF_COLUMNS,
      sf,
      sql`dr.report_date DESC, dr.created_at DESC, dr.id DESC`,
    );
    const from = sql`
      FROM public.daily_reports dr
      LEFT JOIN public.users u ON u.id = dr.user_id
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, COALESCE(sum(l.hours), 0)::numeric AS h
        FROM public.daily_report_lines l
        WHERE l.daily_report_id = dr.id AND l.company_id = ${companyId} AND l.deleted_at IS NULL
      ) agg ON TRUE`;
    const page =
      filters.limit !== undefined
        ? sql`LIMIT ${filters.limit} OFFSET ${filters.offset ?? 0}`
        : sql`OFFSET ${filters.offset ?? 0}`;

    const headers = (await tx.execute(sql`
      SELECT dr.id, dr.user_id AS "userId", to_char(dr.report_date, 'YYYY-MM-DD') AS "reportDate",
             dr.shift, agg.n AS "taskCount", agg.h AS "hours"
      ${from}
      WHERE ${where}
      ORDER BY ${order}
      ${page}
    `)) as unknown as Array<{
      id: string;
      userId: string;
      reportDate: string;
      shift: DailyTaskReportRow['shift'];
      taskCount: number | string;
      hours: number | string | null;
    }>;
    const [cnt] = (await tx.execute(
      sql`SELECT count(*)::int AS n ${from} WHERE ${where}`,
    )) as unknown as Array<{
      n: number | string;
    }>;

    const reports: DailyTaskReportRow[] = headers.map((h) => ({
      id: h.id,
      userId: h.userId,
      userName: names.get(h.userId) ?? null,
      reportDate: h.reportDate,
      shift: h.shift,
      taskCount: Number(h.taskCount) || 0,
      totalHours: Math.round(n(h.hours) * 100) / 100,
      canEdit: isAdmin || h.userId === user.id,
    }));

    const userOptions = canSeeAll ? [...names.entries()].map(([id, name]) => ({ id, name })) : [];
    return { reports, total: Number(cnt?.n ?? 0), isAdmin, canSeeAll, userOptions };
  });
}

async function getReportInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
  user: AuthContext,
  names: Map<string, string>,
): Promise<DailyTaskReportDetail> {
  const rows = await tx
    .select()
    .from(dailyReports)
    .where(
      and(
        eq(dailyReports.id, id),
        eq(dailyReports.companyId, companyId),
        isNull(dailyReports.deletedAt),
      ),
    )
    .limit(1);
  const h = rows[0];
  // Someone else's report reads as not found unless admin / manager.
  if (!h || (!canSeeAllReports(user) && h.userId !== user.id)) {
    throw new NotFoundError(`Daily report ${id} not found`);
  }

  const lineRows = await tx
    .select()
    .from(dailyReportLines)
    .where(and(eq(dailyReportLines.dailyReportId, id), isNull(dailyReportLines.deletedAt)))
    .orderBy(asc(dailyReportLines.lineNo));

  const lines: DailyTaskReportLine[] = lineRows.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    ref: l.ref,
    hours: n(l.hours),
    status: l.status,
    remarks: l.remarks,
  }));
  const totalHours = lines.reduce((s, l) => s + l.hours, 0);

  return {
    id: h.id,
    userId: h.userId,
    userName: names.get(h.userId) ?? null,
    reportDate: h.reportDate,
    shift: h.shift,
    taskCount: lines.length,
    totalHours: Math.round(totalHours * 100) / 100,
    canEdit: user.role === 'admin' || h.userId === user.id,
    lines,
  };
}

export async function getDailyReport(
  id: string,
  user: AuthContext,
): Promise<DailyTaskReportDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);
    return getReportInternal(tx, id, companyId, user, names);
  });
}

async function insertLines(
  tx: DbTransaction,
  companyId: string,
  reportId: string,
  input: UpsertDailyTaskReportInput,
  user: AuthContext,
): Promise<void> {
  let lineNo = 0;
  for (const l of input.lines) {
    lineNo += 1;
    await tx.insert(dailyReportLines).values({
      companyId,
      dailyReportId: reportId,
      lineNo,
      description: l.description,
      ref: l.ref ?? null,
      hours: String(l.hours),
      status: l.status,
      remarks: l.remarks ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    });
  }
}

export async function createDailyReport(
  input: UpsertDailyTaskReportInput,
  user: AuthContext,
): Promise<DailyTaskReportDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const inserted = await tx
      .insert(dailyReports)
      .values({
        companyId,
        userId: user.id, // owner is always the current user (legacy currentUser)
        reportDate: input.reportDate,
        shift: input.shift,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;
    await insertLines(tx, companyId, header.id, input, user);

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Daily Report',
        detail: `Daily report for ${input.reportDate}`,
        refId: input.reportDate,
      },
      companyId,
      user,
    );

    const names = await loadUserNames(tx, companyId);
    return getReportInternal(tx, header.id, companyId, user, names);
  });
}

export async function updateDailyReport(
  id: string,
  input: UpsertDailyTaskReportInput,
  user: AuthContext,
): Promise<DailyTaskReportDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(dailyReports)
      .where(
        and(
          eq(dailyReports.id, id),
          eq(dailyReports.companyId, companyId),
          isNull(dailyReports.deletedAt),
        ),
      )
      .limit(1);
    const h = rows[0];
    if (!h) throw new NotFoundError(`Daily report ${id} not found`);

    // Owner or admin (legacy canEditThis = isAdm || r.userId === userId).
    if (user.role !== 'admin' && h.userId !== user.id) {
      throw new AuthorizationError('Only the report owner or an admin can edit this report');
    }

    await tx
      .update(dailyReports)
      .set({
        reportDate: input.reportDate,
        shift: input.shift,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(dailyReports.id, id));

    // Replace lines: soft-delete existing, insert the new set. The partial
    // unique index (deleted_at is null) lets new line_no 1..n coexist with the
    // soft-deleted rows.
    const now = new Date();
    await tx
      .update(dailyReportLines)
      .set({ deletedAt: now, deletedBy: user.id, updatedBy: user.id, updatedAt: now })
      .where(and(eq(dailyReportLines.dailyReportId, id), isNull(dailyReportLines.deletedAt)));
    await insertLines(tx, companyId, id, input, user);

    await emitActivityLog(
      tx,
      {
        action: 'UPDATE',
        entity: 'Daily Report',
        detail: `Updated daily report for ${input.reportDate}`,
        refId: input.reportDate,
      },
      companyId,
      user,
    );

    const names = await loadUserNames(tx, companyId);
    return getReportInternal(tx, id, companyId, user, names);
  });
}
