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
  ListDailyTaskReportsResponse,
  UpsertDailyTaskReportInput,
} from '@innovic/shared';
import { and, asc, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { dailyReportLines, dailyReports, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const n = (s: string | number | null): number => Number(s ?? 0) || 0;

async function loadUserNames(tx: DbTransaction, companyId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.companyId, companyId));
  return new Map(rows.map((r) => [r.id, r.name ?? '']));
}

export interface DailyReportFilters {
  userId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function listDailyReports(
  filters: DailyReportFilters,
  user: AuthContext,
): Promise<ListDailyTaskReportsResponse> {
  const companyId = requireCompany(user);
  const isAdmin = user.role === 'admin';
  return withUserContext(user, async (tx) => {
    const names = await loadUserNames(tx, companyId);

    const conds = [eq(dailyReports.companyId, companyId), isNull(dailyReports.deletedAt)];
    if (filters.userId) conds.push(eq(dailyReports.userId, filters.userId));
    if (filters.dateFrom) conds.push(gte(dailyReports.reportDate, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(dailyReports.reportDate, filters.dateTo));

    const headers = await tx
      .select()
      .from(dailyReports)
      .where(and(...conds))
      .orderBy(desc(dailyReports.reportDate), desc(dailyReports.createdAt));

    // Aggregate task count + total hours per report.
    const lineRows = await tx
      .select({
        reportId: dailyReportLines.dailyReportId,
        hours: dailyReportLines.hours,
      })
      .from(dailyReportLines)
      .where(and(eq(dailyReportLines.companyId, companyId), isNull(dailyReportLines.deletedAt)));
    const agg = new Map<string, { count: number; hours: number }>();
    for (const l of lineRows) {
      const cur = agg.get(l.reportId) ?? { count: 0, hours: 0 };
      cur.count += 1;
      cur.hours += n(l.hours);
      agg.set(l.reportId, cur);
    }

    const reports: DailyTaskReportRow[] = headers.map((h) => {
      const a = agg.get(h.id) ?? { count: 0, hours: 0 };
      return {
        id: h.id,
        userId: h.userId,
        userName: names.get(h.userId) ?? null,
        reportDate: h.reportDate,
        shift: h.shift,
        taskCount: a.count,
        totalHours: Math.round(a.hours * 100) / 100,
        canEdit: isAdmin || h.userId === user.id,
      };
    });

    const userOptions = [...names.entries()].map(([id, name]) => ({ id, name }));
    return { reports, isAdmin, userOptions };
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
      and(eq(dailyReports.id, id), eq(dailyReports.companyId, companyId), isNull(dailyReports.deletedAt)),
    )
    .limit(1);
  const h = rows[0];
  if (!h) throw new NotFoundError(`Daily report ${id} not found`);

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
        and(eq(dailyReports.id, id), eq(dailyReports.companyId, companyId), isNull(dailyReports.deletedAt)),
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
      .set({ reportDate: input.reportDate, shift: input.shift, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(dailyReports.id, id));

    // Replace lines: soft-delete existing, insert the new set. The partial
    // unique index (deleted_at is null) lets new line_no 1..n coexist with the
    // soft-deleted rows.
    const now = new Date();
    await tx
      .update(dailyReportLines)
      .set({ deletedAt: now, updatedBy: user.id, updatedAt: now })
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
