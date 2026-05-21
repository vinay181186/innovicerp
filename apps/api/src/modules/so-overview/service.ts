// SO Overview service (PL-2).
//
// GET /so-overview — high-level dashboard across all open SOs. Mirrors legacy
// renderSOOverview (HTML L9112) + _deriveSOSummaries (HTML L9065). One row
// per SO header with aggregated stage counters + overall status badge + per-
// line alert flags.
//
// Math reused from PL-1's calc-engine: enrichOps + rollupJC + rollupSoLine
// + derivePerLineStage + deriveOverallSoStatus. The two new helpers live in
// calc-engine.ts so PL-2 + future Planning screens share the decision tree.
//
// Query plan: 6 batched queries. After fetching open SOs, everything else
// goes through Promise.all keyed by the SO IDs (or the lineIds derived from
// the SO lines fetch). No per-SO loops issued against the DB.
//
// Role gate: any authenticated user in the company. RLS enforces cross-
// company isolation at the DB layer.

import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  SoOverviewQuery,
  SoOverviewResponse,
  SoOverviewRow,
  SoOverviewStageCounts,
} from '@innovic/shared';
import {
  items,
  jcOps,
  jobCards,
  opLog,
  runningOps,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  type JCRollup,
  derivePerLineStage,
  deriveOverallSoStatus,
  enrichOps,
  rollupJC,
  rollupSoLine,
} from '../../lib/calc-engine';
import { AuthorizationError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyStageCounts(): SoOverviewStageCounts {
  return {
    notReleased: 0,
    inProduction: 0,
    outsourced: 0,
    qualityCheck: 0,
    finished: 0,
    hold: 0,
  };
}

export async function getSoOverview(
  user: AuthContext,
  query: SoOverviewQuery,
): Promise<SoOverviewResponse> {
  const companyId = requireCompany(user);
  const statusFilter = query.status ?? 'open';
  const search = query.search?.trim() ?? null;
  const today = todayIso();

  return withUserContext(user, async (tx) => {
    // 1. SO headers matching filter.
    const conditions: SQL[] = [
      eq(salesOrders.companyId, companyId),
      isNull(salesOrders.deletedAt),
    ];
    if (statusFilter !== 'all') {
      conditions.push(eq(salesOrders.status, statusFilter));
    }
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        sql`(${salesOrders.code} ILIKE ${term} OR ${salesOrders.customerName} ILIKE ${term} OR ${salesOrders.clientPoNo} ILIKE ${term})`,
      );
    }

    const soHeaders = await tx
      .select()
      .from(salesOrders)
      .where(and(...conditions))
      .orderBy(asc(salesOrders.code));

    if (soHeaders.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        filter: { status: statusFilter, search },
        summary: emptySummary(),
        rows: [],
      };
    }

    const soIds = soHeaders.map((s) => s.id);

    // 2. All SO lines under these SOs.
    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        salesOrderId: salesOrderLines.salesOrderId,
        lineNo: salesOrderLines.lineNo,
        orderQty: salesOrderLines.orderQty,
        dueDate: salesOrderLines.dueDate,
        itemId: salesOrderLines.itemId,
        itemCode: items.code,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .where(and(inArray(salesOrderLines.salesOrderId, soIds), isNull(salesOrderLines.deletedAt)));

    const lineIds = lineRows.map((l) => l.id);

    // 3..6 — JCs + ops + logs + running by lineIds → jcIds. Two rounds.
    const jcRows =
      lineIds.length === 0
        ? []
        : await tx
            .select()
            .from(jobCards)
            .where(
              and(
                inArray(jobCards.sourceSoLineId, lineIds),
                isNull(jobCards.deletedAt),
              ),
            )
            .orderBy(asc(jobCards.code));

    const jcIds = jcRows.map((j) => j.id);

    const [opRows, logRows, runningRows] =
      jcIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            tx
              .select()
              .from(jcOps)
              .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt)))
              .orderBy(asc(jcOps.jobCardId), asc(jcOps.opSeq)),
            tx
              .select()
              .from(opLog)
              .where(
                inArray(
                  opLog.jcOpId,
                  tx
                    .select({ id: jcOps.id })
                    .from(jcOps)
                    .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt))),
                ),
              ),
            tx
              .select({ jcOpId: runningOps.jcOpId })
              .from(runningOps)
              .where(
                and(
                  eq(runningOps.status, 'running'),
                  inArray(
                    runningOps.jcOpId,
                    tx
                      .select({ id: jcOps.id })
                      .from(jcOps)
                      .where(and(inArray(jcOps.jobCardId, jcIds), isNull(jcOps.deletedAt))),
                  ),
                ),
              ),
          ]);

    // Group ops + logs by JC for in-memory rollup.
    const opsByJc = new Map<string, typeof opRows>();
    for (const op of opRows) {
      const arr = opsByJc.get(op.jobCardId);
      if (arr) arr.push(op);
      else opsByJc.set(op.jobCardId, [op]);
    }
    const logsByOp = new Map<string, typeof logRows>();
    for (const log of logRows) {
      const arr = logsByOp.get(log.jcOpId);
      if (arr) arr.push(log);
      else logsByOp.set(log.jcOpId, [log]);
    }
    const runningOpIds = new Set(runningRows.map((r) => r.jcOpId));

    // Build per-JC enriched rollups once. Keyed by JC id for the per-line walk.
    const rollupByJcId = new Map<string, JCRollup>();
    for (const jc of jcRows) {
      const ops = opsByJc.get(jc.id) ?? [];
      const opLogsForJc = ops.flatMap((o) => logsByOp.get(o.id) ?? []);
      const enriched = enrichOps(jc, ops, opLogsForJc, runningOpIds);
      rollupByJcId.set(jc.id, rollupJC(jc, enriched));
    }

    // Group JCs by source line.
    const jcsByLine = new Map<string, string[]>();
    for (const jc of jcRows) {
      if (!jc.sourceSoLineId) continue;
      const arr = jcsByLine.get(jc.sourceSoLineId);
      if (arr) arr.push(jc.id);
      else jcsByLine.set(jc.sourceSoLineId, [jc.id]);
    }

    // Group lines by SO.
    const linesBySo = new Map<string, typeof lineRows>();
    for (const line of lineRows) {
      const arr = linesBySo.get(line.salesOrderId);
      if (arr) arr.push(line);
      else linesBySo.set(line.salesOrderId, [line]);
    }

    // Build per-SO summary rows.
    const rows: SoOverviewRow[] = soHeaders.map((header) => {
      const lines = linesBySo.get(header.id) ?? [];

      let totalRequiredQty = 0;
      let totalDoneQty = 0;
      let delayedLines = 0;
      let qcPendingOps = 0;
      let atVendorQty = 0;
      const stageCounts = emptyStageCounts();
      let earliestDueDate: string | null = null;

      for (const line of lines) {
        const jcRollups: JCRollup[] = (jcsByLine.get(line.id) ?? [])
          .map((id) => rollupByJcId.get(id))
          .filter((r): r is JCRollup => Boolean(r));

        const soLineRollup = rollupSoLine(line.id, line.orderQty, jcRollups);
        totalRequiredQty += line.orderQty;
        totalDoneQty += soLineRollup.doneQty;

        const stage = derivePerLineStage(jcRollups);
        switch (stage) {
          case 'not_released':
            stageCounts.notReleased += 1;
            break;
          case 'in_production':
            stageCounts.inProduction += 1;
            break;
          case 'outsourced':
            stageCounts.outsourced += 1;
            break;
          case 'quality_check':
            stageCounts.qualityCheck += 1;
            break;
          case 'finished':
            stageCounts.finished += 1;
            break;
          case 'hold':
            stageCounts.hold += 1;
            break;
        }

        const lineUnfinished = stage !== 'finished';
        if (lineUnfinished && line.dueDate && line.dueDate < today) {
          delayedLines += 1;
        }
        if (lineUnfinished && line.dueDate) {
          if (!earliestDueDate || line.dueDate < earliestDueDate) {
            earliestDueDate = line.dueDate;
          }
        }

        // Alerts roll up per-op fields.
        for (const jc of jcRollups) {
          for (const op of jc.ops) {
            if (op.status === 'qc_pending') qcPendingOps += 1;
            if (
              op.status === 'outsource_at_vendor' ||
              op.status === 'outsource_po_created'
            ) {
              atVendorQty += Math.max(0, op.inputAvail - op.completed);
            }
          }
        }
      }

      const totalBalanceQty = Math.max(0, totalRequiredQty - totalDoneQty);
      const overallPct =
        totalRequiredQty > 0
          ? Math.min(100, Math.round((totalDoneQty / totalRequiredQty) * 100))
          : 0;
      const overallStatus = deriveOverallSoStatus({
        totalDoneQty,
        totalRequiredQty,
        holdCount: stageCounts.hold,
        finishedCount: stageCounts.finished,
        delayedCount: delayedLines,
        lineCount: lines.length,
        dueDate: earliestDueDate,
        today,
      });

      return {
        id: header.id,
        code: header.code,
        soDate: header.soDate,
        customerName: header.customerName,
        clientPoNo: header.clientPoNo,
        type: header.type,
        status: header.status,
        earliestDueDate,
        bomMasterId: header.bomMasterId,
        lineCount: lines.length,
        totalRequiredQty,
        totalDoneQty,
        totalBalanceQty,
        overallPct,
        overallStatus,
        stageCounts,
        alerts: {
          atVendorQty,
          qcPendingOps,
          delayedLines,
        },
      };
    });

    const summary = {
      soCount: rows.length,
      notStartedCount: rows.filter((r) => r.overallStatus === 'not_started').length,
      inProgressCount: rows.filter((r) => r.overallStatus === 'in_progress').length,
      onTrackCount: rows.filter((r) => r.overallStatus === 'on_track').length,
      delayedCount: rows.filter((r) => r.overallStatus === 'delayed').length,
      completedCount: rows.filter((r) => r.overallStatus === 'completed').length,
      blockedCount: rows.filter((r) => r.overallStatus === 'blocked').length,
    };

    return {
      generatedAt: new Date().toISOString(),
      filter: { status: statusFilter, search },
      summary,
      rows,
    };
  });
}

function emptySummary(): SoOverviewResponse['summary'] {
  return {
    soCount: 0,
    notStartedCount: 0,
    inProgressCount: 0,
    onTrackCount: 0,
    delayedCount: 0,
    completedCount: 0,
    blockedCount: 0,
  };
}
