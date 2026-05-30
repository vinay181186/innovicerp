// Op Log viewer service — read-only paginated view of `op_log` joined with
// jc_ops + job_cards + items + machines + users for human-readable columns.
// Mirror of legacy renderOpLog (HTML L13194).
//
// DELTA from legacy: NO delete action ported. Legacy `delLog` (L13224) hard-
// deleted log rows which violates CLAUDE.md Rule #8 (no hard deletes from
// app code) AND breaks qty-done recalc downstream (every other module's
// progress numbers come off op_log SUMs). Corrections happen via a new
// corrective log entry, not deletion. If a soft-delete column is added
// later, restore the action behind admin-only RLS.

import { and, asc, count, desc, eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import { items, jcOps, jobCards, machines, opLog, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import type { ListOpLogQuery, ListOpLogResponse, OpLogListItem } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

export async function listOpLog(
  input: ListOpLogQuery,
  user: AuthContext,
): Promise<ListOpLogResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(opLog.companyId, companyId)];
    if (input.logType) conditions.push(eq(opLog.logType, input.logType));
    if (input.shift) {
      const shiftCond = eq(opLog.shift, input.shift as 'day' | 'night' | 'general');
      conditions.push(shiftCond);
    }
    if (input.operatorId) conditions.push(eq(opLog.operatorId, input.operatorId));
    if (input.fromDate) conditions.push(gte(opLog.logDate, input.fromDate));
    if (input.toDate) conditions.push(lte(opLog.logDate, input.toDate));
    if (input.jcNo) conditions.push(ilike(jobCards.code, `%${input.jcNo}%`));

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select({
          id: opLog.id,
          logNo: opLog.logNo,
          logType: opLog.logType,
          logDate: opLog.logDate,
          jcNo: jobCards.code,
          itemCode: items.code,
          opSeq: jcOps.opSeq,
          operation: jcOps.operation,
          machineCode: machines.code,
          machineCodeText: jcOps.machineCodeText,
          shift: opLog.shift,
          qty: opLog.qty,
          rejectQty: opLog.rejectQty,
          operatorName: opLog.operatorName,
          remarks: opLog.remarks,
          isTpi: opLog.isTpi,
          qcReportPath: opLog.qcReportPath,
          qcReportName: opLog.qcReportName,
          createdAt: opLog.createdAt,
          createdBy: opLog.createdBy,
          createdByName: users.fullName,
        })
        .from(opLog)
        .innerJoin(jcOps, eq(jcOps.id, opLog.jcOpId))
        .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
        .innerJoin(items, eq(items.id, jobCards.itemId))
        .leftJoin(machines, eq(machines.id, jcOps.machineId))
        .leftJoin(users, eq(users.id, opLog.createdBy))
        .where(where)
        .orderBy(desc(opLog.logDate), desc(opLog.createdAt), asc(opLog.logNo))
        .limit(input.limit)
        .offset(input.offset),
      tx
        .select({ value: count() })
        .from(opLog)
        .innerJoin(jcOps, eq(jcOps.id, opLog.jcOpId))
        .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
        .where(where),
    ]);

    const items_: OpLogListItem[] = rows.map((r) => ({
      id: r.id,
      logNo: r.logNo,
      logType: r.logType,
      logDate: r.logDate,
      jcNo: r.jcNo,
      itemCode: r.itemCode ?? null,
      opSeq: r.opSeq,
      operation: r.operation,
      machineCode: r.machineCode ?? r.machineCodeText ?? null,
      shift: r.shift,
      qty: r.qty,
      rejectQty: r.rejectQty,
      operatorName: r.operatorName,
      remarks: r.remarks,
      isTpi: r.isTpi,
      qcReportPath: r.qcReportPath,
      qcReportName: r.qcReportName,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      createdByName: r.createdByName,
    }));

    return {
      items: items_,
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}
