// SO Status Review service (PL-1).
//
// Single read endpoint: GET /so-status/:soId. Ports legacy renderSOStatus
// (HTML L4255) — per-line breakdown with 6 progress chips, linked JC table
// with op-level drill-down, outsource tracking alerts.
//
// All math lives in apps/api/src/lib/calc-engine.ts (ported from legacy
// calcEngine() at HTML L1626). This file only does the batched reads + shape
// assembly. No N+1 — one SELECT per logical entity, joined in memory via
// Map lookups. Per CLAUDE.md §6 rule #4 + §6 rule #6.
//
// Role gate: any authenticated user in the SO's company. RLS handles
// cross-company isolation at the DB; service is just defensive.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  SoStatusBomItem,
  SoStatusEquipmentInfo,
  SoStatusJc,
  SoStatusLine,
  SoStatusPendingOsPrOp,
  SoStatusResponse,
} from '@innovic/shared';
import {
  bomMasterLines,
  bomMasters,
  deliveryChallanLines,
  deliveryChallans,
  goodsReceiptNoteLines,
  itemStockBalances,
  items,
  jcOps,
  jobCards,
  opLog,
  plans,
  purchaseOrderLines,
  runningOps,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  type EnrichedOp,
  type JCRollup,
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

export async function getSoStatus(soId: string, user: AuthContext): Promise<SoStatusResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // 1. SO header — also the company-scope gate. NotFoundError covers both
    // "missing" and "wrong company" — RLS would prevent the row from showing
    // anyway, but the explicit company filter keeps the error message clean.
    const headerRows = await tx
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
    const header = headerRows[0];
    if (!header) throw new NotFoundError(`Sales order ${soId} not found`);

    // 2. SO lines + item code via LEFT JOIN. Ordered by line_no.
    const lineRows = await tx
      .select({
        id: salesOrderLines.id,
        lineNo: salesOrderLines.lineNo,
        itemId: salesOrderLines.itemId,
        itemCodeText: salesOrderLines.itemCodeText,
        partName: salesOrderLines.partName,
        orderQty: salesOrderLines.orderQty,
        dueDate: salesOrderLines.dueDate,
        clientPoLineNo: salesOrderLines.clientPoLineNo,
        itemCode: items.code,
      })
      .from(salesOrderLines)
      .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
      .where(and(eq(salesOrderLines.salesOrderId, soId), isNull(salesOrderLines.deletedAt)))
      .orderBy(asc(salesOrderLines.lineNo));

    const lineIds = lineRows.map((l) => l.id);

    // Early exit when the SO has no lines — chips are all (0, 0), no JC fetch.
    if (lineIds.length === 0) {
      return buildEmptyResponse(header);
    }

    // 3..9 — fetch everything we need in parallel. Each query is keyed by
    // either `lineIds` or `jcIds` / `opIds` derived from the JC fetch, so
    // queries 3+4 must run before 5..8. Three sequential rounds total.

    // Round 1: JCs for these lines + PO/GRN/Disp aggs keyed by lineIds (no
    // JC dependency).
    const [jcRows, poAggRes, grnAggRes, dispAggRes] = await Promise.all([
      tx
        .select({
          id: jobCards.id,
          code: jobCards.code,
          itemId: jobCards.itemId,
          orderQty: jobCards.orderQty,
          priority: jobCards.priority,
          dueDate: jobCards.dueDate,
          sourceSoLineId: jobCards.sourceSoLineId,
          itemCode: items.code,
          itemName: items.name,
          // Full JC row needed for calc-engine
          companyId: jobCards.companyId,
          jcDate: jobCards.jcDate,
          drawingFilePath: jobCards.drawingFilePath,
          sourceJwLineId: jobCards.sourceJwLineId,
          sourceLegacyRef: jobCards.sourceLegacyRef,
          parentNcId: jobCards.parentNcId,
          closedAt: jobCards.closedAt,
          createdAt: jobCards.createdAt,
          createdBy: jobCards.createdBy,
          updatedAt: jobCards.updatedAt,
          updatedBy: jobCards.updatedBy,
          deletedAt: jobCards.deletedAt,
        })
        .from(jobCards)
        .leftJoin(items, and(eq(items.id, jobCards.itemId), isNull(items.deletedAt)))
        .where(
          and(
            inArray(jobCards.sourceSoLineId, lineIds),
            isNull(jobCards.deletedAt),
          ),
        )
        .orderBy(asc(jobCards.code)),

      tx
        .select({
          lineId: purchaseOrderLines.sourceSoLineId,
          qty: sql<number>`COALESCE(SUM(${purchaseOrderLines.qty}), 0)::int`,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            inArray(purchaseOrderLines.sourceSoLineId, lineIds),
            isNull(purchaseOrderLines.deletedAt),
          ),
        )
        .groupBy(purchaseOrderLines.sourceSoLineId),

      tx
        .select({
          lineId: purchaseOrderLines.sourceSoLineId,
          recvQty: sql<number>`COALESCE(SUM(${goodsReceiptNoteLines.receivedQty}), 0)::int`,
          qcAccQty: sql<number>`COALESCE(SUM(${goodsReceiptNoteLines.qcAcceptedQty}), 0)::int`,
        })
        .from(goodsReceiptNoteLines)
        .innerJoin(
          purchaseOrderLines,
          eq(purchaseOrderLines.id, goodsReceiptNoteLines.purchaseOrderLineId),
        )
        .where(
          and(
            inArray(purchaseOrderLines.sourceSoLineId, lineIds),
            isNull(goodsReceiptNoteLines.deletedAt),
            isNull(purchaseOrderLines.deletedAt),
          ),
        )
        .groupBy(purchaseOrderLines.sourceSoLineId),

      // Customer dispatch DCs = SO-line-linked AND no procurement PO link
      // (OSP DCs have purchase_order_id set; customer dispatches don't).
      // delivery_challan_lines.qty is numeric; sum returns text → cast to int
      // for the chip display (DC qtys are integers in practice).
      tx
        .select({
          lineId: deliveryChallans.salesOrderLineId,
          qty: sql<number>`COALESCE(SUM(${deliveryChallanLines.qty}), 0)::int`,
        })
        .from(deliveryChallanLines)
        .innerJoin(
          deliveryChallans,
          eq(deliveryChallans.id, deliveryChallanLines.deliveryChallanId),
        )
        .where(
          and(
            inArray(deliveryChallans.salesOrderLineId, lineIds),
            isNull(deliveryChallans.purchaseOrderId),
            isNull(deliveryChallans.deletedAt),
            isNull(deliveryChallanLines.deletedAt),
          ),
        )
        .groupBy(deliveryChallans.salesOrderLineId),
    ]);

    const jcIds = jcRows.map((j) => j.id);

    // Round 2: ops + logs + running keyed by JCs. Skip when no JCs.
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
                  // Sub-select avoids a second round-trip — fetch op_log for any
                  // op whose job_card_id is in our JC list. Safe under RLS because
                  // op_log's company_isolation policy mirrors jc_ops's.
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

    // Group ops + logs by job_card_id for in-memory rollup.
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

    // Build JC rollups via calc-engine.
    const rollupByJcId = new Map<string, { rollup: JCRollup; ops: EnrichedOp[] }>();
    for (const jc of jcRows) {
      const jcForCalc = {
        ...jc,
        sourceSoLineId: jc.sourceSoLineId,
      };
      const ops = opsByJc.get(jc.id) ?? [];
      const opLogsForJc = ops.flatMap((o) => logsByOp.get(o.id) ?? []);
      const enriched = enrichOps(jcForCalc as never, ops, opLogsForJc, runningOpIds);
      const rollup = rollupJC(jcForCalc as never, enriched);
      rollupByJcId.set(jc.id, { rollup, ops: enriched });
    }

    // Aggs by line id
    const poAggByLine = new Map<string, number>();
    for (const r of poAggRes) {
      if (r.lineId) poAggByLine.set(r.lineId, Number(r.qty));
    }
    const grnAggByLine = new Map<string, { recvQty: number; qcAccQty: number }>();
    for (const r of grnAggRes) {
      if (r.lineId) {
        grnAggByLine.set(r.lineId, {
          recvQty: Number(r.recvQty ?? 0),
          qcAccQty: Number(r.qcAccQty ?? 0),
        });
      }
    }
    const dispAggByLine = new Map<string, number>();
    for (const r of dispAggRes) {
      if (r.lineId) dispAggByLine.set(r.lineId, Number(r.qty));
    }

    // JCs by source_so_line_id
    const jcsByLine = new Map<string, typeof jcRows>();
    for (const jc of jcRows) {
      if (!jc.sourceSoLineId) continue;
      const arr = jcsByLine.get(jc.sourceSoLineId);
      if (arr) arr.push(jc);
      else jcsByLine.set(jc.sourceSoLineId, [jc]);
    }

    // Build the per-line response.
    const lines: SoStatusLine[] = lineRows.map((line) => {
      const jcsForLine = jcsByLine.get(line.id) ?? [];
      const rollupsForLine: JCRollup[] = jcsForLine.map(
        (jc) => rollupByJcId.get(jc.id)!.rollup,
      );

      const soLineRollup = rollupSoLine(line.id, line.orderQty, rollupsForLine);

      const jcIssuedQty = jcsForLine.reduce((s, j) => s + j.orderQty, 0);
      const poQty = poAggByLine.get(line.id) ?? 0;
      const grnAgg = grnAggByLine.get(line.id);
      const recvQty = grnAgg?.recvQty ?? 0;
      const qcAccQty = grnAgg?.qcAccQty ?? 0;
      const dispQty = dispAggByLine.get(line.id) ?? 0;

      // Outsource tracking across all ops of all JCs linked to this line.
      // Carry the parent jc per op so we can emit pendingOps[] for the UI's
      // inline "📋 PR Op<N>" buttons (PL-1b §2.3).
      const outsourceOps = jcsForLine.flatMap((jc) =>
        rollupByJcId
          .get(jc.id)!
          .ops.filter((op) => op.opType === 'outsource')
          .map((op) => ({ op, jcId: jc.id, jcCode: jc.code })),
      );
      let atVendorQty = 0;
      let atVendorOpCount = 0;
      let pendingPrCount = 0;
      let prRaisedCount = 0;
      const pendingOps: SoStatusPendingOsPrOp[] = [];
      for (const { op, jcId: opJcId, jcCode } of outsourceOps) {
        if (op.status === 'outsource_at_vendor' || op.status === 'outsource_po_created') {
          atVendorQty += Math.max(0, op.inputAvail - op.completed);
          atVendorOpCount += 1;
        }
        if (op.status === 'outsource_pending') {
          pendingPrCount += 1;
          pendingOps.push({
            jcId: opJcId,
            jcCode,
            opSeq: op.opSeq,
            operation: op.operation,
          });
        }
        if (op.status === 'outsource_pr_raised') prRaisedCount += 1;
      }

      const jobCardsOut: SoStatusJc[] = jcsForLine.map((jc) => {
        const { rollup, ops } = rollupByJcId.get(jc.id)!;
        return {
          id: jc.id,
          code: jc.code,
          itemCode: jc.itemCode ?? null,
          itemName: jc.itemName ?? null,
          orderQty: jc.orderQty,
          doneQty: rollup.doneQty,
          remainingQty: rollup.remainingQty,
          completionPct: rollup.completionPct,
          totalOps: rollup.totalOps,
          doneOps: rollup.doneOps,
          qcPendOps: rollup.qcPendOps,
          priority: jc.priority,
          dueDate: jc.dueDate,
          status: rollup.status,
          ops: ops.map((op) => ({
            id: op.id,
            opSeq: op.opSeq,
            operation: op.operation,
            opType: op.opType,
            machineId: op.machineId,
            machineCodeText: op.machineCodeText,
            qcRequired: op.qcRequired,
            outsourceStatus: op.outsourceStatus,
            outsourcePrId: op.outsourcePrId,
            completed: op.completed,
            qcAccepted: op.qcAccepted,
            qcRejected: op.qcRejected,
            qcPending: op.qcPending,
            inputAvail: op.inputAvail,
            available: op.available,
            running: op.running,
            status: op.status,
          })),
        };
      });

      return {
        id: line.id,
        lineNo: line.lineNo,
        clientPoLineNo: line.clientPoLineNo,
        itemCode: line.itemCode ?? null,
        itemCodeText: line.itemCodeText,
        partName: line.partName ?? null,
        orderQty: line.orderQty,
        dueDate: line.dueDate,
        status: soLineRollup.lineStatus,
        doneQty: soLineRollup.doneQty,
        remainingQty: soLineRollup.remainingQty,
        completionPct: soLineRollup.completionPct,
        chips: {
          jcIssued: { qty: jcIssuedQty, total: line.orderQty },
          poRaised: { qty: poQty, total: line.orderQty },
          grnReceived: { qty: recvQty, total: poQty || line.orderQty },
          qcAccepted: { qty: qcAccQty, total: recvQty || line.orderQty },
          produced: { qty: soLineRollup.doneQty, total: line.orderQty },
          dispatched: { qty: dispQty, total: line.orderQty },
        },
        outsourceAlert: {
          atVendorQty,
          atVendorOpCount,
          pendingPrCount,
          prRaisedCount,
          pendingOps,
        },
        jobCards: jobCardsOut,
      };
    });

    const totalQty = lines.reduce((s, l) => s + l.orderQty, 0);
    const totalDoneQty = lines.reduce((s, l) => s + l.doneQty, 0);
    const overallPct =
      totalQty > 0 ? Math.min(100, Math.round((totalDoneQty / totalQty) * 100)) : 0;

    // Equipment-SO BOM banner + items table (PL-1b §1.1 + §3). Only when
    // type='equipment' AND a real uuid bomMasterId is set (defends against
    // legacy text values like 'demo-bom-001' stored in the uuid column).
    const isEquipment = header.type === 'equipment';
    const equipmentBomId =
      isEquipment && header.bomMasterId && UUID_RE.test(header.bomMasterId)
        ? header.bomMasterId
        : null;

    let equipmentInfo: SoStatusEquipmentInfo | null = null;
    let bomItems: SoStatusBomItem[] = [];

    if (isEquipment) {
      const firstLine = lineRows[0] ?? null;
      const equipmentQty = lineRows.reduce((s, l) => s + l.orderQty, 0);
      equipmentInfo = {
        equipmentItemCode: firstLine?.itemCode ?? firstLine?.itemCodeText ?? null,
        equipmentItemName: firstLine?.partName ?? null,
        equipmentQty,
        bomNo: null,
        bomRev: null,
        bomName: null,
        bomPartsCount: 0,
      };

      if (equipmentBomId) {
        const [bomHeaderRows, bomLineRows] = await Promise.all([
          tx
            .select({
              id: bomMasters.id,
              bomNo: bomMasters.bomNo,
              bomName: bomMasters.bomName,
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
          equipmentInfo.bomNo = bomHeader.bomNo;
          equipmentInfo.bomRev = bomHeader.revision;
          equipmentInfo.bomName = bomHeader.bomName;
          equipmentInfo.bomPartsCount = bomLineRows.length;
        }

        if (bomLineRows.length > 0) {
          const childIds = bomLineRows.map((c) => c.bml.childItemId);
          const [stockRows, existingPlanRows] = await Promise.all([
            tx
              .select({ itemId: itemStockBalances.itemId, qty: itemStockBalances.onHandQty })
              .from(itemStockBalances)
              .where(
                and(
                  eq(itemStockBalances.companyId, companyId),
                  inArray(itemStockBalances.itemId, childIds),
                ),
              ),
            tx
              .select({
                plan: plans,
                jcCode: jobCards.code,
              })
              .from(plans)
              .leftJoin(jobCards, eq(jobCards.id, plans.jcId))
              .where(
                and(
                  inArray(plans.soLineId, lineIds),
                  isNull(plans.deletedAt),
                  sql`${plans.planStatus} <> 'cancelled'`,
                ),
              ),
          ]);
          const stockMap = new Map<string, number>();
          for (const s of stockRows) stockMap.set(s.itemId, Number(s.qty));

          // Bucket existing plans by bomChildCode (skip assembly plans).
          const planByChildCode = new Map<
            string,
            { status: string; code: string; jcCode: string | null }
          >();
          for (const r of existingPlanRows) {
            if (r.plan.planType === 'assembly') continue;
            const code = r.plan.bomChildCode;
            if (!code) continue;
            planByChildCode.set(code, {
              status: r.plan.planStatus,
              code: r.plan.code,
              jcCode: r.jcCode ?? null,
            });
          }

          bomItems = bomLineRows.map((c) => {
            const qtyPerSet = Number(c.bml.qtyPerSet);
            const totalNeed = qtyPerSet * equipmentQty;
            const stockQty = stockMap.get(c.bml.childItemId) ?? 0;
            const shortfall = Math.max(0, totalNeed - stockQty);
            const existing = planByChildCode.get(c.childCode);
            return {
              childItemId: c.bml.childItemId,
              childItemCode: c.childCode,
              childItemName: c.childName,
              qtyPerSet,
              totalNeed,
              stockQty,
              shortfall,
              bomType: c.bml.bomType,
              planStatus: existing?.status ?? null,
              planCode: existing?.code ?? null,
              jcCode: existing?.jcCode ?? null,
            };
          });
        }
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      header: {
        id: header.id,
        code: header.code,
        type: header.type,
        status: header.status,
        soDate: header.soDate,
        dueDate: null,
        customerName: header.customerName,
        clientPoNo: header.clientPoNo,
        remarks: header.remarks,
        bomMasterId: equipmentBomId,
        bomStatus: header.bomStatus,
        gstPercent: header.gstPercent,
        totalQty,
        totalDoneQty,
        overallCompletionPct: overallPct,
        equipmentInfo,
      },
      lines,
      bomItems,
    };
  });
}

function buildEmptyResponse(
  header: typeof salesOrders.$inferSelect,
): SoStatusResponse {
  const equipmentBomId =
    header.type === 'equipment' && header.bomMasterId && UUID_RE.test(header.bomMasterId)
      ? header.bomMasterId
      : null;
  return {
    generatedAt: new Date().toISOString(),
    header: {
      id: header.id,
      code: header.code,
      type: header.type,
      status: header.status,
      soDate: header.soDate,
      dueDate: null,
      customerName: header.customerName,
      clientPoNo: header.clientPoNo,
      remarks: header.remarks,
      bomMasterId: equipmentBomId,
      bomStatus: header.bomStatus,
      gstPercent: header.gstPercent,
      totalQty: 0,
      totalDoneQty: 0,
      overallCompletionPct: 0,
      equipmentInfo: null,
    },
    lines: [],
    bomItems: [],
  };
}
