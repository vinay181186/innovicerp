// GET /so-planning/lines (ADR-268) — the Planning first screen: ONE ROW PER LINE
// of every open SO, then every open JWSO, same line set as the order list and
// the order detail. Every figure is built the way getPlanningSoDetail builds it,
// from the same helpers (list-lines-plans.ts, line-facts.ts) and the same shared
// rules; list-lines.test.ts holds the list and the order together.
//
// Batched: a fixed number of queries however many orders are open — up to 8 with
// no source chosen, one transaction. Never the detail in a loop.

import { planningLineStatus, soLinePlanCoverage, toPlanningLineStatus } from '@innovic/shared';
import type {
  PlanningLineListItem,
  PlanningLineListQuery,
  PlanningLineListResponse,
} from '@innovic/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bomMasterLines,
  bomMasters,
  itemRevisions,
  items,
  jobWorkOrderLines,
  jobWorkOrders,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { createdByNameSql } from '../../lib/created-by-sql';
import {
  liveJwCustomerName,
  liveSoCustomerName,
  loadDirectJcsByLine,
  loadPrsByLine,
  requireCompany,
  toProcurementType,
  UUID_RE,
} from './line-facts';
import { requireFormAccess } from '../../lib/access';
import {
  type PlanningLinePageRow,
  pagePlanningLines,
  toPlanningLinePageRow,
} from './list-lines-page';
import { type ListPlansOfLines, loadListPlansByLine } from './list-lines-plans';

/** What both sources give for a line, before its plans and cover are joined on. */
interface LineFacts {
  id: string;
  soId: string;
  soCode: string;
  soInternalNo: string | null;
  customerName: string | null;
  soType: string;
  lineNo: number;
  clientPoLineNo: string | null;
  itemId: string | null;
  itemCodeText: string | null;
  partName: string | null;
  itemRevisionId: string | null;
  orderQty: number;
  dueDate: string | null;
  createdAt: Date;
  createdByName: string | null;
  shortClosedAt: Date | null;
  itemCode: string | null;
  itemName: string | null;
  itemProcurementType: string | null;
  itemRevision: string | null;
  drawingRev: string | null;
}

/** The row as the detail's compose step builds it; `cover` is what differs by source. */
function composeRow(
  r: LineFacts,
  source: 'so' | 'jw',
  cover: Pick<PlanningLineListItem, 'plans' | 'prs' | 'prQty' | 'totalPlanned'> & {
    directJc: { qty: number; codes: string[] } | undefined;
  },
): PlanningLinePageRow {
  const { orderQty } = r;
  const directJcQty = cover.directJc?.qty ?? 0;
  // ADR-196 / ADR-268 — a line closed short wants nothing more, SO or JW.
  const shortClosed = r.shortClosedAt !== null;
  const remaining = shortClosed ? 0 : Math.max(0, orderQty - cover.totalPlanned - directJcQty);
  return toPlanningLinePageRow(
    {
      soId: r.soId,
      soCode: r.soCode,
      soInternalNo: r.soInternalNo,
      source,
      customerName: r.customerName,
      soType: r.soType,
      soLineId: r.id,
      itemRevisionId: r.drawingRev ? r.itemRevisionId : null,
      drawingRev: r.drawingRev,
      lineNo: r.lineNo,
      clientPoLineNo: r.clientPoLineNo,
      createdAt: r.createdAt.toISOString(),
      createdByName: r.createdByName,
      itemId: r.itemId,
      itemCode: r.itemCode ?? r.itemCodeText,
      itemRevision: r.itemRevision,
      itemName: r.itemName ?? r.partName,
      orderQty,
      dueDate: r.dueDate,
      itemProcurementType: toProcurementType(r.itemProcurementType),
      prQty: cover.prQty,
      prs: cover.prs,
      plans: cover.plans,
      totalPlanned: cover.totalPlanned,
      directJcQty,
      directJcCodes: cover.directJc?.codes ?? [],
      remaining,
      shortClosed,
      lineStatus: toPlanningLineStatus(
        planningLineStatus({
          orderQty,
          remaining,
          totalPlanned: cover.totalPlanned,
          directJcQty,
          plans: cover.plans,
          shortClosed,
        }).state,
      ),
    },
    { itemCodeText: r.itemCodeText, partName: r.partName },
  );
}

/** The header Equipment BOMs' parent item + parts (ADR-221), keyed by BOM id. One
 *  query. Same facts as getPlanningSoDetail step 7a: a BOM in Trash is absent, so
 *  its line is an ordinary line there and here. */
async function loadEquipmentBoms(
  tx: DbTransaction,
  companyId: string,
  bomIds: string[],
): Promise<
  Map<string, { parentItemId: string | null; lines: Array<{ code: string; qtyPerSet: number }> }>
> {
  const map = new Map<
    string,
    { parentItemId: string | null; lines: Array<{ code: string; qtyPerSet: number }> }
  >();
  if (bomIds.length === 0) return map;
  const rows = await tx
    .select({
      id: bomMasters.id,
      parentItemId: bomMasters.parentItemId,
      code: items.code,
      qtyPerSet: bomMasterLines.qtyPerSet,
    })
    .from(bomMasters)
    .leftJoin(
      bomMasterLines,
      and(eq(bomMasterLines.bomMasterId, bomMasters.id), isNull(bomMasterLines.deletedAt)),
    )
    .leftJoin(items, eq(items.id, bomMasterLines.childItemId))
    .where(
      and(
        inArray(bomMasters.id, bomIds),
        eq(bomMasters.companyId, companyId),
        isNull(bomMasters.deletedAt),
      ),
    );
  for (const r of rows) {
    const entry = map.get(r.id) ?? { parentItemId: r.parentItemId, lines: [] };
    if (r.code !== null && r.qtyPerSet !== null) {
      entry.lines.push({ code: r.code, qtyPerSet: Number(r.qtyPerSet) });
    }
    map.set(r.id, entry);
  }
  return map;
}

function loadSoLines(tx: DbTransaction, companyId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      soId: salesOrders.id,
      soCode: salesOrders.code,
      soInternalNo: salesOrders.internalSoNo,
      customerName: liveSoCustomerName(),
      soType: salesOrders.type,
      soBomMasterId: salesOrders.bomMasterId,
      lineNo: salesOrderLines.lineNo,
      clientPoLineNo: salesOrderLines.clientPoLineNo,
      itemId: salesOrderLines.itemId,
      itemCodeText: salesOrderLines.itemCodeText,
      partName: salesOrderLines.partName,
      itemRevisionId: salesOrderLines.itemRevisionId,
      orderQty: salesOrderLines.orderQty,
      dueDate: salesOrderLines.dueDate,
      createdAt: salesOrderLines.createdAt,
      createdByName: createdByNameSql(salesOrderLines.createdBy),
      shortClosedAt: salesOrderLines.shortClosedAt,
      itemCode: items.code,
      itemName: items.name,
      itemProcurementType: items.procurementType,
      // Cast as the detail casts it — see getPlanningSoDetail step 2.
      itemRevision: sql<string | null>`${salesOrderLines.revision}::text`,
      drawingRev: itemRevisions.rev,
    })
    .from(salesOrderLines)
    .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .leftJoin(items, and(eq(items.id, salesOrderLines.itemId), isNull(items.deletedAt)))
    .leftJoin(
      itemRevisions,
      and(eq(itemRevisions.id, salesOrderLines.itemRevisionId), isNull(itemRevisions.deletedAt)),
    )
    .where(
      and(
        eq(salesOrders.companyId, companyId),
        isNull(salesOrders.deletedAt),
        eq(salesOrders.status, 'open'),
        isNull(salesOrderLines.deletedAt),
        // ADR-185 — the same line set as the order list and the detail.
        sql`${salesOrderLines.status} <> 'cancelled'`,
      ),
    )
    .orderBy(desc(salesOrders.code), asc(salesOrderLines.lineNo));
}

async function composeSoRows(
  tx: DbTransaction,
  companyId: string,
  lines: Awaited<ReturnType<typeof loadSoLines>>,
  { plansByLine, bomMasterByPlan }: ListPlansOfLines,
): Promise<PlanningLinePageRow[]> {
  const lineIds = lines.map((l) => l.id);
  const directJcByLine = await loadDirectJcsByLine(tx, lines, 'so');
  const prsByLine = await loadPrsByLine(tx, companyId, lineIds);

  const equipBomIdOf = (l: (typeof lines)[number]): string | null =>
    l.soType === 'equipment' && l.soBomMasterId && UUID_RE.test(l.soBomMasterId)
      ? l.soBomMasterId
      : null;
  const equipBoms = await loadEquipmentBoms(tx, companyId, [
    ...new Set(lines.map(equipBomIdOf).filter((id): id is string => id !== null)),
  ]);

  return lines.map((l) => {
    const plansOfLine = plansByLine.get(l.id) ?? [];
    const linePrs = prsByLine.get(l.id) ?? { prs: [], prQty: 0 };
    const equipBomId = equipBomIdOf(l);
    const equip = equipBomId ? equipBoms.get(equipBomId) : undefined;
    // THE equipment line is the one whose item is the live header BOM's parent.
    const isEquipmentLine =
      equip !== undefined && equip.parentItemId !== null && l.itemId === equip.parentItemId;
    const totalPlanned = soLinePlanCoverage({
      isEquipmentLine,
      orderQty: l.orderQty,
      plans: plansOfLine.map((p) => ({
        planQty: p.planQty,
        bomMasterId: bomMasterByPlan.get(p.id) ?? null,
        bomChildCode: p.bomChildCode,
      })),
      bomLines: isEquipmentLine ? equip.lines : [],
      buyPrQty: toProcurementType(l.itemProcurementType) === 'buy' ? linePrs.prQty : 0,
    }).planned;
    return composeRow(l, 'so', {
      plans: plansOfLine,
      prs: linePrs.prs,
      prQty: linePrs.prQty,
      totalPlanned,
      directJc: directJcByLine.get(l.id),
    });
  });
}

function loadJwLines(tx: DbTransaction, companyId: string) {
  return tx
    .select({
      id: jobWorkOrderLines.id,
      soId: jobWorkOrders.id,
      soCode: jobWorkOrders.code,
      customerName: liveJwCustomerName(),
      lineNo: jobWorkOrderLines.lineNo,
      clientPoLineNo: jobWorkOrderLines.clientPoLineNo,
      itemId: jobWorkOrderLines.itemId,
      itemCodeText: jobWorkOrderLines.itemCodeText,
      partName: jobWorkOrderLines.partName,
      itemRevisionId: jobWorkOrderLines.itemRevisionId,
      orderQty: jobWorkOrderLines.orderQty,
      dueDate: jobWorkOrderLines.dueDate,
      createdAt: jobWorkOrderLines.createdAt,
      createdByName: createdByNameSql(jobWorkOrderLines.createdBy),
      shortClosedAt: jobWorkOrderLines.shortClosedAt,
      itemCode: items.code,
      itemName: items.name,
      itemProcurementType: items.procurementType,
      revision: jobWorkOrderLines.revision,
      drawingRev: itemRevisions.rev,
    })
    .from(jobWorkOrderLines)
    .innerJoin(jobWorkOrders, eq(jobWorkOrders.id, jobWorkOrderLines.jobWorkOrderId))
    .leftJoin(items, and(eq(items.id, jobWorkOrderLines.itemId), isNull(items.deletedAt)))
    .leftJoin(
      itemRevisions,
      and(eq(itemRevisions.id, jobWorkOrderLines.itemRevisionId), isNull(itemRevisions.deletedAt)),
    )
    .where(
      and(
        eq(jobWorkOrders.companyId, companyId),
        isNull(jobWorkOrders.deletedAt),
        eq(jobWorkOrders.status, 'open'),
        isNull(jobWorkOrderLines.deletedAt),
        // ADR-185 — the same line set as the order list and the detail.
        sql`${jobWorkOrderLines.status} <> 'cancelled'`,
      ),
    )
    .orderBy(desc(jobWorkOrders.code), asc(jobWorkOrderLines.lineNo));
}

async function composeJwRows(
  tx: DbTransaction,
  lines: Awaited<ReturnType<typeof loadJwLines>>,
  { plansByLine }: ListPlansOfLines,
): Promise<PlanningLinePageRow[]> {
  const directJcByLine = await loadDirectJcsByLine(tx, lines, 'jw');

  return lines.map((l) => {
    const plansOfLine = plansByLine.get(l.id) ?? [];
    return composeRow(
      // ADR-177: an empty Rev on a JW line reads null → bare item code. A JWSO
      // has no Internal SO No. (ADR-207) and its type is always job work.
      { ...l, soInternalNo: null, soType: 'job_work', itemRevision: l.revision || null },
      'jw',
      {
        plans: plansOfLine,
        // ADR-171: a job-work line is the client's material — never bought in.
        prs: [],
        prQty: 0,
        totalPlanned: plansOfLine.reduce((s, p) => s + p.planQty, 0),
        directJc: directJcByLine.get(l.id),
      },
    );
  });
}

export async function listPlanningLines(
  user: AuthContext,
  query: PlanningLineListQuery = {},
): Promise<PlanningLineListResponse> {
  // The screen's own switch ("Hide page"), enforced here too (§22.2.6).
  await requireFormAccess(user, 'plan_create', 'view');
  const companyId = requireCompany(user);
  const rows = await withUserContext(user, async (tx) => {
    // In sequence: one transaction, one connection. SO rows first, then JW.
    const soLines = query.src === 'jw' ? [] : await loadSoLines(tx, companyId);
    const jwLines = query.src === 'so' ? [] : await loadJwLines(tx, companyId);
    const planned = await loadListPlansByLine(
      tx,
      soLines.map((l) => l.id),
      jwLines.map((l) => l.id),
    );
    return [
      ...(await composeSoRows(tx, companyId, soLines, planned)),
      ...(await composeJwRows(tx, jwLines, planned)),
    ];
  });
  // Paged after the transaction: no connection held for in-memory work.
  return pagePlanningLines(rows, query);
}
