// QC History service (QC Wave 2) — read-only.
//
// GET /qc-history          — the whole feed: pending QC ops + the last 500 QC
//                            log entries + tracking stats (older callers).
// GET /qc-history/pending  — QC Pending ops, one page + total (ADR-201).
// GET /qc-history/logs     — completed QC entries, one page + total (ADR-201).
// GET /qc-history/stats    — the KPI figures over EVERY row (ADR-201).
// Mirrors legacy renderQCHistory (HTML L23531). Raw SQL over v_jc_op_status +
// op_log (log_type='qc'); the SQL pieces live in sql.ts. RLS via base tables.

import { sql } from 'drizzle-orm';
import type {
  ListQcLogsQuery,
  ListQcPendingQuery,
  QcHistoryResponse,
  QcHistoryStats,
  QcLogsListResponse,
  QcPendingListResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { QC_LOGS_SF_COLUMNS, QC_PENDING_SF_COLUMNS } from './sf-columns';
import {
  LOGS_ORDER,
  LOGS_SELECT,
  PENDING_ORDER,
  PENDING_SELECT,
  PEND_SINCE,
  logsFrom,
  opSearchWhere,
  overdueToday,
  pendingFrom,
  toLogRow,
  toPendingRow,
} from './sql';

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

type Raw = Record<string, unknown>;
const rows = (r: unknown): Raw[] => r as Raw[];

/** QC Pending ops — one page, total over the same WHERE (search + sf). */
export async function listQcPending(
  input: ListQcPendingQuery,
  user: AuthContext,
): Promise<QcPendingListResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const where = sql`${pendingFrom(companyId)} ${opSearchWhere(input.search)} ${sfWhere(QC_PENDING_SF_COLUMNS, sf)}`;
  const order = sfOrderBy(QC_PENDING_SF_COLUMNS, sf, PENDING_ORDER);
  const today = overdueToday();
  return withUserContext(user, async (tx) => {
    const page = await tx.execute(sql`
      SELECT ${PENDING_SELECT} ${where}
      ORDER BY ${order}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);
    const cnt = await tx.execute(sql`SELECT COUNT(*)::int AS n ${where}`);
    return {
      items: rows(page).map((r) => toPendingRow(r, today)),
      total: Number(rows(cnt)[0]?.['n'] ?? 0),
    };
  });
}

/** Completed QC entries — one page, total over search + date range + sf. */
export async function listQcLogs(
  input: ListQcLogsQuery,
  user: AuthContext,
): Promise<QcLogsListResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const where = sql`${logsFrom(companyId)} ${opSearchWhere(input.search)}
    ${input.dateFrom ? sql`AND ol.log_date >= ${input.dateFrom}::date` : sql``}
    ${input.dateTo ? sql`AND ol.log_date <= ${input.dateTo}::date` : sql``}
    ${sfWhere(QC_LOGS_SF_COLUMNS, sf)}`;
  const order = sfOrderBy(QC_LOGS_SF_COLUMNS, sf, LOGS_ORDER);
  return withUserContext(user, async (tx) => {
    const page = await tx.execute(sql`
      SELECT ${LOGS_SELECT} ${where}
      ORDER BY ${order}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);
    const cnt = await tx.execute(sql`SELECT COUNT(*)::int AS n ${where}`);
    return {
      items: rows(page).map(toLogRow),
      total: Number(rows(cnt)[0]?.['n'] ?? 0),
    };
  });
}

/** KPI figures over every row (not the page): pending ops, overdue, entries, today. */
export async function getQcHistoryStats(user: AuthContext): Promise<QcHistoryStats> {
  const companyId = requireCompany(user);
  const today = overdueToday();
  return withUserContext(user, async (tx) => {
    const pend = await tx.execute(sql`
      SELECT COUNT(*)::int AS "pendingOps",
        COUNT(*) FILTER (WHERE ${PEND_SINCE} < ${today}::date)::int AS "overdue"
      ${pendingFrom(companyId)}
    `);
    const logs = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS "totalEntries",
        COUNT(*) FILTER (WHERE log_date = CURRENT_DATE)::int AS "today"
      FROM public.op_log
      WHERE company_id = ${companyId}::uuid AND log_type = 'qc'
    `);
    const p = rows(pend)[0] ?? {};
    const l = rows(logs)[0] ?? {};
    return {
      pendingOps: Number(p['pendingOps'] ?? 0),
      overdue: Number(p['overdue'] ?? 0),
      totalEntries: Number(l['totalEntries'] ?? 0),
      today: Number(l['today'] ?? 0),
    };
  });
}

/** The whole feed (older callers): every pending op + the last 500 QC entries. */
export async function getQcHistory(user: AuthContext): Promise<QcHistoryResponse> {
  const companyId = requireCompany(user);
  const today = overdueToday();
  const result = await withUserContext(user, async (tx) => {
    const pendingRows = await tx.execute(sql`
      SELECT ${PENDING_SELECT} ${pendingFrom(companyId)} ORDER BY ${PENDING_ORDER}
    `);
    const logRows = await tx.execute(sql`
      SELECT ${LOGS_SELECT} ${logsFrom(companyId)} ORDER BY ${LOGS_ORDER} LIMIT 500
    `);
    return {
      pending: rows(pendingRows).map((r) => toPendingRow(r, today)),
      logs: rows(logRows).map(toLogRow),
    };
  });
  const stats = await getQcHistoryStats(user);
  return { stats, ...result };
}
