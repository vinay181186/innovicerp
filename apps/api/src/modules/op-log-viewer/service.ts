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

import { and, asc, count, desc, eq, gte, ilike, lte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  machines,
  opLog,
  salesOrderLines,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import type { ListOpLogQuery, ListOpLogResponse, OpLogListItem } from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Second handle on machines for the PLANNED machine (jc_ops.machine_id); the
// first join below is the machine the row was ACTUALLY made on (ADR-164).
const plannedMachine = alias(machines, 'planned_machine');

export async function listOpLog(
  input: ListOpLogQuery,
  user: AuthContext,
): Promise<ListOpLogResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // The machine a log row belongs to: the machine stamped on the LOG (migration
    // 0095 — the one the qty was actually made on), falling back to the op's
    // machine for rows the backfill could not resolve. Used for both the join and
    // the machine filter so the two can never disagree.
    const logMachine = sql`COALESCE(${opLog.machineId}, ${jcOps.machineId})`;

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
    // machineId + fromDate/toDate together answer "what did CNC-01 produce between
    // these two dates" — the date-range machine report the Daily Report cannot
    // give, because that one is locked to a single day.
    if (input.machineId) conditions.push(sql`${logMachine} = ${input.machineId}::uuid`);

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select({
          id: opLog.id,
          logNo: opLog.logNo,
          logType: opLog.logType,
          logDate: opLog.logDate,
          jcNo: jobCards.code,
          jobCardId: jobCards.id,
          itemCode: items.code,
          // WHAT was being made. The register printed a JC number and an item
          // code and nothing else, and a JC number says WHICH JOB, not WHICH
          // PART — two cards for two similar parts read identically. The item
          // was already joined for the code; the name costs nothing more.
          itemName: items.name,
          // The CUSTOMER'S drawing revision, read live off the SO line the card
          // was raised against rather than snapshotted, so a reissued drawing
          // shows its new revision on every log row against that card. A
          // JWSO-sourced card reads the JW line's Rev instead (ADR-177). LEFT
          // JOINs: a standalone card has neither line and must still appear in
          // the log, with a null revision and the bare code. Never
          // items.revision — that column describes the item master and would
          // print a plausible-looking lie in the drawing's place.
          itemRevision: sql<
            string | null
          >`COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)`,
          // POL — the line number printed on the CUSTOMER'S own purchase order,
          // off the same already-joined SO line as the revision above. No JW
          // branch on purpose: a job-work line has no customer PO, so a
          // JW-sourced or standalone card is correctly null.
          clientPoLineNo: salesOrderLines.clientPoLineNo,
          opSeq: jcOps.opSeq,
          operation: jcOps.operation,
          machineCode: machines.code,
          logMachineCodeText: opLog.machineCodeText,
          machineCodeText: jcOps.machineCodeText,
          // The PLAN beside the ACTUAL above (ADR-164): the op's own machine,
          // live code, or its text snapshot -- never the 'QC' type label.
          plannedMachineCode: sql<
            string | null
          >`COALESCE(${plannedMachine.code}, NULLIF(${jcOps.machineCodeText}, 'QC'))`,
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
        .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobCards.sourceSoLineId))
        .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jobCards.sourceJwLineId))
        .leftJoin(machines, sql`${machines.id} = ${logMachine}`)
        .leftJoin(plannedMachine, eq(plannedMachine.id, jcOps.machineId))
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
      jobCardId: r.jobCardId,
      itemCode: r.itemCode ?? null,
      itemName: r.itemName ?? null,
      itemRevision: r.itemRevision ?? null,
      clientPoLineNo: r.clientPoLineNo ?? null,
      opSeq: r.opSeq,
      operation: r.operation,
      // Live master code first, then the LOG's snapshot, then the OP's snapshot.
      machineCode: r.machineCode ?? r.logMachineCodeText ?? r.machineCodeText ?? null,
      plannedMachineCode: r.plannedMachineCode ?? null,
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
