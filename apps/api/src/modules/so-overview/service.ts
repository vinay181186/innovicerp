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
  SoOverallStatus,
  SoOverviewChildRow,
  SoOverviewDetailResponse,
  SoOverviewItemStage,
  SoOverviewQuery,
  SoOverviewResponse,
  SoOverviewRow,
  SoOverviewStageCounts,
} from '@innovic/shared';
import {
  bomMasterLines,
  bomMasters,
  items,
  jcOps,
  jobCards,
  machines,
  opLog,
  runningOps,
  salesOrderLines,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  type EnrichedOp,
  type JCRollup,
  type LineStage,
  derivePerLineStage,
  deriveOverallSoStatus,
  enrichOps,
  rollupJC,
  rollupSoLine,
} from '../../lib/calc-engine';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function stageToWireEnum(s: LineStage): SoOverviewItemStage {
  return s; // identical enums; kept as a function so future re-mapping is local.
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
        partName: salesOrderLines.partName,
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

      // Equipment-SO name from the first line's partName. Component SOs leave
      // this null so the UI can render an em-dash. (PL-2b §1.4 — adds the
      // missing Equipment column on the list.)
      const equipmentItemName =
        header.type === 'equipment' && lines.length > 0 ? lines[0]!.partName : null;

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
        equipmentItemName,
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

// ─── Drill-down (PL-2b §2) ───────────────────────────────────────────────

/** Walk an SO's lines (Component / With Material / Equipment-no-BOM) OR its
 *  BOM children (Equipment + bomMasterId) and emit the per-item rollup that
 *  drives the SO Overview drill view. Lazy-load: one call per row click. */
export async function getSoOverviewDetail(
  soId: string,
  user: AuthContext,
): Promise<SoOverviewDetailResponse> {
  if (!UUID_RE.test(soId)) throw new NotFoundError(`Sales order ${soId} not found`);
  const companyId = requireCompany(user);
  const today = todayIso();

  return withUserContext(user, async (tx) => {
    // 1. SO header.
    const soHeaders = await tx
      .select()
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = soHeaders[0];
    if (!header) throw new NotFoundError(`Sales order ${soId} not found`);

    // 2. SO lines + items.
    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        salesOrderId: salesOrderLines.salesOrderId,
        lineNo: salesOrderLines.lineNo,
        clientPoLineNo: salesOrderLines.clientPoLineNo,
        orderQty: salesOrderLines.orderQty,
        dueDate: salesOrderLines.dueDate,
        itemId: salesOrderLines.itemId,
        itemCode: items.code,
        itemName: items.name,
        partName: salesOrderLines.partName,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .where(
        and(eq(salesOrderLines.salesOrderId, soId), isNull(salesOrderLines.deletedAt)),
      )
      .orderBy(asc(salesOrderLines.lineNo));

    const lineIds = lineRows.map((l) => l.id);

    // 3. JCs + ops + logs + running + machines + vendors. Three batched rounds.
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

    // Machine + vendor name lookups (so the drill table can show ⚙ <machine>
    // / 🏭 <vendor>). One-shot fetch keyed off ops' machine_id + osp_vendor_id.
    const opMachineIds = Array.from(
      new Set(opRows.map((o) => o.machineId).filter((id): id is string => Boolean(id))),
    );
    const opVendorIds = Array.from(
      new Set(
        opRows
          .map((o) => o.outsourceVendorId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const [machineRows, vendorRows] = await Promise.all([
      opMachineIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({ id: machines.id, code: machines.code, name: machines.name })
            .from(machines)
            .where(and(inArray(machines.id, opMachineIds), isNull(machines.deletedAt))),
      opVendorIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({ id: vendors.id, code: vendors.code, name: vendors.name })
            .from(vendors)
            .where(and(inArray(vendors.id, opVendorIds), isNull(vendors.deletedAt))),
    ]);
    const machineMap = new Map(machineRows.map((m) => [m.id, m.name]));
    const vendorMap = new Map(vendorRows.map((v) => [v.id, v.name]));

    // Group ops + logs + build enriched JC rollups.
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

    const rollupByJcId = new Map<string, { rollup: JCRollup; ops: EnrichedOp[] }>();
    for (const jc of jcRows) {
      const ops = opsByJc.get(jc.id) ?? [];
      const opLogsForJc = ops.flatMap((o) => logsByOp.get(o.id) ?? []);
      const enriched = enrichOps(jc, ops, opLogsForJc, runningOpIds);
      rollupByJcId.set(jc.id, { rollup: rollupJC(jc, enriched), ops: enriched });
    }

    // EnrichedOp drops outsource_vendor_id/text — keep a lookup by op id so
    // the drill row builder can name the vendor.
    const vendorByOpId = new Map<
      string,
      { vendorId: string | null; vendorText: string | null }
    >();
    for (const op of opRows) {
      vendorByOpId.set(op.id, {
        vendorId: op.outsourceVendorId,
        vendorText: op.outsourceVendorText,
      });
    }

    // Equipment SO with BOM → walk BOM children; else walk SO lines.
    const isEquipment = header.type === 'equipment';
    const equipmentBomId =
      isEquipment && header.bomMasterId && UUID_RE.test(header.bomMasterId)
        ? header.bomMasterId
        : null;
    const equipmentQty = lineRows.reduce((s, l) => s + l.orderQty, 0);

    let bomNo: string | null = null;
    let bomRev: number | null = null;
    let childRows: SoOverviewChildRow[] = [];
    let isEquipmentDrill = false;

    if (equipmentBomId) {
      const [bomHeaderRows, bomChildRows] = await Promise.all([
        tx
          .select({
            id: bomMasters.id,
            bomNo: bomMasters.bomNo,
            revision: bomMasters.revision,
          })
          .from(bomMasters)
          .where(
            and(
              eq(bomMasters.id, equipmentBomId),
              eq(bomMasters.companyId, companyId),
              isNull(bomMasters.deletedAt),
            ),
          )
          .limit(1),
        tx
          .select({
            bml: bomMasterLines,
            childCode: items.code,
            childName: items.name,
          })
          .from(bomMasterLines)
          .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
          .where(
            and(
              eq(bomMasterLines.bomMasterId, equipmentBomId),
              isNull(bomMasterLines.deletedAt),
            ),
          )
          .orderBy(asc(bomMasterLines.lineNo)),
      ]);
      const bomHeader = bomHeaderRows[0];
      if (bomHeader) {
        bomNo = bomHeader.bomNo;
        bomRev = bomHeader.revision;
      }
      if (bomChildRows.length > 0) {
        isEquipmentDrill = true;
        // Bucket JCs by their item_id so we can attribute them to BOM children.
        const jcsByItem = new Map<string, typeof jcRows>();
        for (const jc of jcRows) {
          if (!jc.itemId) continue;
          const arr = jcsByItem.get(jc.itemId);
          if (arr) arr.push(jc);
          else jcsByItem.set(jc.itemId, [jc]);
        }
        childRows = bomChildRows.map((c) =>
          buildChildRow({
            rowId: c.bml.childItemId,
            itemCode: c.childCode,
            itemName: c.childName,
            requiredQty: Number(c.bml.qtyPerSet) * equipmentQty,
            lineNo: null,
            clientPoLineNo: null,
            lineDueDate: lineRows[0]?.dueDate ?? null,
            jcs: jcsByItem.get(c.bml.childItemId) ?? [],
            rollupByJcId,
            machineMap,
            vendorMap,
            vendorByOpId,
            today,
          }),
        );
      }
    }

    if (!isEquipmentDrill) {
      // Component / With Material / Equipment-no-BOM → one row per SO line.
      const jcsByLine = new Map<string, typeof jcRows>();
      for (const jc of jcRows) {
        if (!jc.sourceSoLineId) continue;
        const arr = jcsByLine.get(jc.sourceSoLineId);
        if (arr) arr.push(jc);
        else jcsByLine.set(jc.sourceSoLineId, [jc]);
      }
      childRows = lineRows.map((line) =>
        buildChildRow({
          rowId: line.id,
          itemCode: line.itemCode ?? line.partName ?? '—',
          itemName: line.itemName ?? line.partName ?? '—',
          requiredQty: line.orderQty,
          lineNo: line.lineNo,
          clientPoLineNo: line.clientPoLineNo,
          lineDueDate: line.dueDate,
          jcs: jcsByLine.get(line.id) ?? [],
          rollupByJcId,
          machineMap,
          vendorMap,
          vendorByOpId,
          today,
        }),
      );
    }

    // Build the SO summary row we echo back (matches getSoOverview shape so
    // the front-end can reuse the same renderer).
    const totalRequiredQty = childRows.reduce((s, r) => s + r.requiredQty, 0);
    const totalDoneQty = childRows.reduce((s, r) => s + r.completedQty, 0);
    const totalBalanceQty = Math.max(0, totalRequiredQty - totalDoneQty);
    const overallPct =
      totalRequiredQty > 0
        ? Math.min(100, Math.round((totalDoneQty / totalRequiredQty) * 100))
        : 0;
    const stageCounts = emptyStageCounts();
    let delayedLines = 0;
    let qcPendingOps = 0;
    let atVendorQty = 0;
    let earliestDueDate: string | null = null;
    for (const r of childRows) {
      switch (r.stage) {
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
      if (r.status === 'delayed') delayedLines += 1;
      qcPendingOps += r.qcPendingQty > 0 ? 1 : 0;
      atVendorQty += r.atVendorQty;
    }
    for (const l of lineRows) {
      if (l.dueDate && (!earliestDueDate || l.dueDate < earliestDueDate)) {
        earliestDueDate = l.dueDate;
      }
    }
    const overallStatus = deriveOverallSoStatus({
      totalDoneQty,
      totalRequiredQty,
      holdCount: stageCounts.hold,
      finishedCount: stageCounts.finished,
      delayedCount: delayedLines,
      lineCount: childRows.length,
      dueDate: earliestDueDate,
      today,
    });

    const so: SoOverviewRow = {
      id: header.id,
      code: header.code,
      soDate: header.soDate,
      customerName: header.customerName,
      clientPoNo: header.clientPoNo,
      type: header.type,
      status: header.status,
      earliestDueDate,
      bomMasterId: equipmentBomId,
      equipmentItemName:
        isEquipment && lineRows.length > 0 ? (lineRows[0]!.partName ?? null) : null,
      lineCount: lineRows.length,
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

    return {
      generatedAt: new Date().toISOString(),
      so,
      isEquipmentDrill,
      bomNo,
      bomRev,
      childRows,
    };
  });
}

// ─── Drill child-row builder ─────────────────────────────────────────────

interface BuildChildRowInput {
  rowId: string;
  itemCode: string;
  itemName: string;
  requiredQty: number;
  lineNo: number | null;
  clientPoLineNo: string | null;
  lineDueDate: string | null;
  jcs: Array<typeof jobCards.$inferSelect>;
  rollupByJcId: Map<string, { rollup: JCRollup; ops: EnrichedOp[] }>;
  machineMap: Map<string, string>;
  vendorMap: Map<string, string>;
  vendorByOpId: Map<string, { vendorId: string | null; vendorText: string | null }>;
  today: string;
}

function buildChildRow(input: BuildChildRowInput): SoOverviewChildRow {
  const { rowId, itemCode, itemName, requiredQty, lineNo, clientPoLineNo, lineDueDate, jcs, rollupByJcId, machineMap, vendorMap, vendorByOpId, today } = input;

  const enriched = jcs.flatMap((jc) => rollupByJcId.get(jc.id)?.ops ?? []);
  const jcRollups = jcs.map((jc) => rollupByJcId.get(jc.id)?.rollup).filter((r): r is JCRollup => Boolean(r));

  // Quantity aggregates.
  let completedQty = 0;
  let qcPendingQty = 0;
  let atVendorQty = 0;
  let inProductionQty = 0;
  let currentOpName: string | null = null;
  let machineName: string | null = null;
  let vendorName: string | null = null;
  let currentLocation: 'Factory' | 'Vendor' | 'QC' = 'Factory';

  for (const jc of jcs) {
    const r = rollupByJcId.get(jc.id);
    if (r) completedQty += r.rollup.doneQty;
  }

  for (const op of enriched) {
    if (op.status === 'qc_pending') {
      qcPendingQty += op.qcPending;
      if (!currentOpName) currentOpName = op.operation;
      currentLocation = 'QC';
    }
    if (
      op.status === 'outsource_at_vendor' ||
      op.status === 'outsource_po_created' ||
      op.status === 'outsource_pr_raised'
    ) {
      atVendorQty += Math.max(0, op.inputAvail - op.completed);
      if (!currentOpName) currentOpName = op.operation;
      const v = vendorByOpId.get(op.id);
      if (v?.vendorId && vendorMap.has(v.vendorId)) {
        vendorName = vendorMap.get(v.vendorId)!;
      } else if (v?.vendorText) {
        vendorName = v.vendorText;
      }
      if (currentLocation !== 'QC') currentLocation = 'Vendor';
    }
    if (
      op.opType !== 'outsource' &&
      op.opType !== 'qc' &&
      op.status !== 'complete' &&
      (op.status === 'running' || op.status === 'in_progress' || op.completed > 0)
    ) {
      inProductionQty += Math.max(0, op.completed);
      if (op.machineId && machineMap.has(op.machineId)) {
        machineName = machineMap.get(op.machineId)!;
      } else if (op.machineCodeText) {
        machineName = op.machineCodeText;
      }
      if (!currentOpName) currentOpName = op.operation;
    }
  }

  const balanceQty = Math.max(0, requiredQty - completedQty);

  // Hold flag — not currently surfaced by our JCs; reserved for future.
  const stage: SoOverviewItemStage = stageToWireEnum(
    derivePerLineStage(jcRollups, { hold: false }),
  );

  // Per-row status uses the same overall status machine, scoped to one line.
  const isDelayed =
    !!lineDueDate && lineDueDate < today && completedQty < requiredQty;
  const status: SoOverallStatus = deriveOverallSoStatus({
    totalDoneQty: completedQty,
    totalRequiredQty: requiredQty,
    holdCount: 0,
    finishedCount: stage === 'finished' ? 1 : 0,
    delayedCount: isDelayed ? 1 : 0,
    lineCount: 1,
    dueDate: lineDueDate,
    today,
  });

  return {
    rowId,
    lineNo,
    clientPoLineNo,
    itemCode,
    itemName,
    stage,
    status,
    requiredQty,
    issuedQty: 0, // store_transactions integration deferred — see PARITY §3 DELTA.
    inProductionQty,
    qcPendingQty,
    atVendorQty,
    completedQty,
    balanceQty,
    currentOpName,
    machineName,
    vendorName,
    currentLocation,
  };
}
