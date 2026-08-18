// Assembly Tracker service (PL-5 — final slice of Phase B per ADR-030).
//
// Per-Equipment-SO multi-level BOM readiness rollup + per-unit assembly
// tracking + dispatch flags. Mirrors legacy renderAssemblyTracker (HTML
// L28738) and its derived counters _deriveAssemblyReadiness.
//
// Math (per-component readiness):
//   totalNeed     = qtyPerSet * SO.orderQty
//   autoReadyQty  = min(stockQty, totalNeed)
//   overrideQty   = assembly_tracking.ready_qty_override (default 0)
//   finalReady    = max(autoReadyQty, overrideQty)
//   enoughForUnits = floor(finalReady / qtyPerSet)
//   shortfall     = max(0, remainingNeed - min(stock|override, remainingNeed))
//                   where remainingNeed = qtyPerSet * (orderQty - assembledQty)
//                   — a shortage against the units STILL to build, not the whole
//                   order (assembling debits stock, so a full-order shortfall
//                   would count consumed parts as missing and never fall).
//
// Rollup:
//   canAssemble   = min(enoughForUnits) across all components
//   bottleneck    = component with the minimum enoughForUnits
//   assembledQty  = SUM(qty) of non-deleted assembly_units (batch-aware)
//   dispatchedQty = SUM(qty) of assembled units with dispatched=true
//   status        = done (assembledQty >= orderQty)
//                 | assembling (assembledQty > 0)
//                 | ready (canAssemble > 0 and assembledQty == 0)
//                 | waiting (otherwise)

import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  AssemblyComponentRow,
  AssemblyComponentStatus,
  AssemblyListResponse,
  AssemblyTrackerResponse,
  AssemblyUnitRow,
  AssemblyUnitStatus,
  DocumentTraceability,
  MarkUnitAssembledInput,
  MarkUnitDispatchedInput,
  RelatedDoc,
  RelatedSection,
  SetReadinessOverrideInput,
  StartAssemblyInput,
  StopAssemblyInput,
} from '@innovic/shared';
import {
  assemblyTracking,
  assemblyUnits,
  bomMasterLines,
  bomMasters,
  customerDispatchLines,
  customerDispatches,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  applyAssemblyStockCascade,
  assemblyDebitExists,
  reverseAssemblyStockCascade,
} from './stock-cascade';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveStatus(
  orderQty: number,
  assembledQty: number,
  inProgressQty: number,
  canAssemble: number,
): 'waiting' | 'ready' | 'assembling' | 'done' {
  if (orderQty > 0 && assembledQty >= orderQty) return 'done';
  // A started-but-not-completed batch (WIP) is also "assembling".
  if (assembledQty > 0 || inProgressQty > 0) return 'assembling';
  if (canAssemble > 0) return 'ready';
  return 'waiting';
}

function deriveComponentStatus(
  totalNeed: number,
  finalReady: number,
  enoughForUnits: number,
): AssemblyComponentStatus {
  if (totalNeed > 0 && finalReady >= totalNeed) return 'ready';
  if (enoughForUnits > 0) return 'enough_for_some';
  return 'shortage';
}

// ─── Main aggregator ──────────────────────────────────────────────────────

export async function getAssemblyTracker(
  soId: string,
  user: AuthContext,
): Promise<AssemblyTrackerResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // 1. SO header (must exist, must be Equipment type, must have BOM)
    const soRows = await tx
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
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);

    // BOM resolve (header + child lines). Equipment SO without a BOM still
    // works — the components list is just empty and canAssemble = 0.
    let bomRow: typeof bomMasters.$inferSelect | null = null;
    if (so.bomMasterId) {
      const r = await tx
        .select()
        .from(bomMasters)
        .where(and(eq(bomMasters.id, so.bomMasterId), isNull(bomMasters.deletedAt)))
        .limit(1);
      bomRow = r[0] ?? null;
    }

    // SO line for partNo / partName + first line's orderQty as the unit count.
    // Equipment SOs typically have 1 line whose orderQty is "units of the
    // assembled equipment" — same convention as the legacy app.
    const unitsRequired = await sumEquipmentLineQty(tx, soId);

    // Assembled units — read BEFORE the component readiness loop so `Short` can
    // be measured against the units still to build (unitsRequired − assembled),
    // not the full order. A record can carry qty > 1 (batch assemble), so both
    // counters SUM the per-record qty rather than counting rows.
    const unitRows = await tx
      .select()
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.salesOrderId, soId),
          isNull(assemblyUnits.deletedAt),
        ),
      )
      .orderBy(asc(assemblyUnits.unitNo));
    const rawUnits = unitRows.map(toUnitRow);

    // Reconcile dispatch status with the REAL Customer Dispatch register.
    // assembly_units.dispatched is only ever set by the legacy in-app "mark
    // dispatched" action; dispatch now runs through Customer Dispatch, which
    // records customer_dispatch_lines and never touches that flag. So a batch
    // dispatched via the register would otherwise read "Pending" forever. Pull
    // the register's dispatched qty for this SO and attribute it (FIFO by batch
    // no.) to completed batches that aren't already flagged, stamping the
    // covering dispatch date. Legacy-flagged units are kept as-is (and excluded
    // from the FIFO) so historical data does not regress.
    const dispEvents = (await tx.execute(sql`
      SELECT cd.dispatch_date::text AS dispatch_date, cdl.qty::int AS qty
      FROM public.customer_dispatch_lines cdl
      JOIN public.customer_dispatches cd ON cd.id = cdl.customer_dispatch_id
      WHERE cd.sales_order_id = ${soId}::uuid
        AND cd.company_id = ${companyId}::uuid
        AND cd.deleted_at IS NULL AND cdl.deleted_at IS NULL
      ORDER BY cd.dispatch_date ASC, cd.created_at ASC
    `)) as unknown as Array<{ dispatch_date: string; qty: number }>;
    const queue = dispEvents.map((e) => ({ date: e.dispatch_date, qty: Number(e.qty) }));

    const units = rawUnits.map((u) => {
      if (u.status !== 'completed' || u.dispatched) return u;
      // A batch flips to dispatched only when the register can cover its WHOLE
      // qty; a partial leaves it Pending (it still has undispatched pieces).
      const avail = queue.reduce((s, ev) => s + ev.qty, 0);
      if (avail < u.qty) return u;
      let need = u.qty;
      let coverDate: string | null = null;
      for (const ev of queue) {
        if (need <= 0) break;
        if (ev.qty <= 0) continue;
        const take = Math.min(ev.qty, need);
        ev.qty -= take;
        need -= take;
        coverDate = ev.date;
      }
      return { ...u, dispatched: true, dispatchDate: coverDate };
    });

    // Assembled = completed batches only; in-progress (WIP) batches are started
    // but not yet built, so they debit no stock and don't count as assembled
    // until stopped (ADR-129).
    const assembledQty = units.reduce((sum, u) => (u.status === 'completed' ? sum + u.qty : sum), 0);
    const inProgressQty = units.reduce((sum, u) => (u.status === 'in_progress' ? sum + u.qty : sum), 0);
    const dispatchedQty = units.reduce((sum, u) => (u.dispatched ? sum + u.qty : sum), 0);
    // Units still owed on the order (not yet completed). `Short` is a shortage
    // against THESE, so components already consumed into built units don't read
    // as missing.
    const remainingUnits = Math.max(0, unitsRequired - assembledQty);

    const components: AssemblyComponentRow[] = [];
    if (bomRow) {
      const childRows = await tx
        .select({
          line: bomMasterLines,
          itemCode: items.code,
          itemName: items.name,
        })
        .from(bomMasterLines)
        .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
        .where(and(eq(bomMasterLines.bomMasterId, bomRow.id), isNull(bomMasterLines.deletedAt)))
        .orderBy(asc(bomMasterLines.lineNo));

      const childIds = childRows.map((r) => r.line.childItemId);
      const stockMap = new Map<string, number>();
      if (childIds.length > 0) {
        const stockRows = await tx
          .select({
            itemId: itemStockBalances.itemId,
            qty: itemStockBalances.onHandQty,
          })
          .from(itemStockBalances)
          .where(
            and(
              eq(itemStockBalances.companyId, companyId),
              inArray(itemStockBalances.itemId, childIds),
            ),
          );
        for (const r of stockRows) stockMap.set(r.itemId, Number(r.qty));
      }

      const overrideMap = await fetchOverrideMap(tx, companyId, soId);

      for (const r of childRows) {
        const childCode = r.itemCode ?? '—';
        const qtyPerSet = Number(r.line.qtyPerSet);
        const totalNeed = Math.round(qtyPerSet * unitsRequired);
        const stockQty = Math.max(0, Math.floor(stockMap.get(r.line.childItemId) ?? 0));
        const autoReadyQty = Math.min(stockQty, totalNeed);
        const overrideQty = overrideMap.get(childCode) ?? 0;
        const finalReadyQty = Math.max(autoReadyQty, overrideQty);
        // Short = shortage to finish the REMAINING units, not the full order.
        // Assembling debits components from stock, so a full-order shortfall
        // (totalNeed − finalReady) would climb by the amount already consumed
        // and never fall as you build. Measuring against remainingNeed keeps it
        // honest: it aligns with the "In Assembly" column (qtyPerSet ×
        // remainingUnits) and drops to 0 once stock covers what's left.
        const remainingNeed = Math.round(qtyPerSet * remainingUnits);
        const readyForRemaining = Math.max(Math.min(stockQty, remainingNeed), Math.min(overrideQty, remainingNeed));
        const shortfall = Math.max(0, remainingNeed - readyForRemaining);
        const enoughForUnits = qtyPerSet > 0 ? Math.floor(finalReadyQty / qtyPerSet) : 0;
        components.push({
          childItemId: r.line.childItemId,
          childItemCode: childCode,
          childItemName: r.itemName,
          bomType: r.line.bomType,
          qtyPerSet,
          totalNeed,
          stockQty,
          autoReadyQty,
          overrideQty,
          finalReadyQty,
          shortfall,
          enoughForUnits,
          status: deriveComponentStatus(totalNeed, finalReadyQty, enoughForUnits),
        });
      }
    }

    // Rollup
    let canAssembleAdditional = 0;
    let bottleneck: { childItemCode: string; enoughForUnits: number } | null = null;
    if (components.length > 0) {
      let min = Infinity;
      let minRow: AssemblyComponentRow | null = null;
      for (const c of components) {
        if (c.enoughForUnits < min) {
          min = c.enoughForUnits;
          minRow = c;
        }
      }
      // Headroom for a NEW start: what stock can build, capped by the order
      // balance NOT already committed — completed AND in-progress both count
      // as committed, so we never offer to start beyond the order (ADR-129).
      canAssembleAdditional = Math.max(
        0,
        Math.min(min === Infinity ? 0 : min, Math.max(0, unitsRequired - assembledQty - inProgressQty)),
      );
      bottleneck = minRow
        ? { childItemCode: minRow.childItemCode, enoughForUnits: minRow.enoughForUnits }
        : null;
    }

    return {
      generatedAt: new Date().toISOString(),
      header: {
        soId: so.id,
        soCode: so.code,
        customerName: so.customerName,
        type: so.type,
        status: so.status,
        bomMasterId: so.bomMasterId,
        bomCode: bomRow?.bomNo ?? null,
        bomName: bomRow?.bomName ?? null,
        partNoText: null, // legacy stores on the SO line; future enhancement
        partName: null,
        orderQty: unitsRequired,
      },
      components,
      rollup: {
        orderQty: unitsRequired,
        assembledQty,
        inProgressQty,
        dispatchedQty,
        balanceQty: Math.max(0, unitsRequired - assembledQty),
        canAssembleAdditional,
        bottleneck,
        status: deriveStatus(unitsRequired, assembledQty, inProgressQty, canAssembleAdditional),
      },
      units,
    };
  });
}

// ─── List Equipment SOs ───────────────────────────────────────────────────

export async function listAssemblies(user: AuthContext): Promise<AssemblyListResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Pull all Equipment SOs (open + dispatched) + their assembled counts.
    // One round-trip via raw SQL for the counts aggregation.
    // Two queries — one for SO headers (with optional BOM code), one for the
    // assembled-counts aggregate. Joined in memory. Simpler than wrestling
    // with LATERAL / scalar subquery binding edge cases.
    const soRows = await tx
      .select({
        soId: salesOrders.id,
        soCode: salesOrders.code,
        customerName: salesOrders.customerName,
        bomMasterId: salesOrders.bomMasterId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
          eq(salesOrders.type, 'equipment'),
          // Closed orders have nothing left to assemble, and legacy drops them
          // (_atBuildAssemblies, HTML L28675: `so.status!=='Closed'`). Ours
          // listed them, so the tracker was mostly finished work — 7 of the 11
          // equipment SOs on the live DB. Only 'closed' is excluded, matching
          // legacy exactly; a cancelled SO still shows.
          ne(salesOrders.status, 'closed'),
        ),
      )
      .orderBy(asc(salesOrders.code));

    const soIds = soRows.map((r) => r.soId);
    // Defensive: a legacy SO can carry a non-UUID string in `bom_master_id`
    // (e.g. SO-DEMO-EQ in this dev DB) — those rows can't be joined against
    // bom_masters (uuid) so we skip them. They surface in the list with
    // bomCode=null.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const bomIds = soRows
      .map((r) => r.bomMasterId)
      .filter((id): id is string => id !== null && UUID_RE.test(id));

    const [orderQtyRows, assembledAggRows, bomCodes] = await Promise.all([
      soIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              soId: salesOrderLines.salesOrderId,
              orderQty: sql<number>`COALESCE(SUM(${salesOrderLines.orderQty}), 0)::int`,
              earliestDueDate: sql<string | null>`MIN(${salesOrderLines.dueDate})::text`,
            })
            .from(salesOrderLines)
            .where(
              and(
                inArray(salesOrderLines.salesOrderId, soIds),
                isNull(salesOrderLines.deletedAt),
              ),
            )
            .groupBy(salesOrderLines.salesOrderId),
      soIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              soId: assemblyUnits.salesOrderId,
              // Batch records carry qty > 1 — SUM(qty), not COUNT(rows).
              // Assembled counts COMPLETED batches only; in-progress (WIP) is
              // tracked separately so the list can show "assembling" (ADR-129).
              assembled: sql<number>`COALESCE(SUM(${assemblyUnits.qty}) FILTER (WHERE ${assemblyUnits.status} = 'completed'), 0)::int`,
              inProgress: sql<number>`COALESCE(SUM(${assemblyUnits.qty}) FILTER (WHERE ${assemblyUnits.status} = 'in_progress'), 0)::int`,
              dispatched: sql<number>`COALESCE(SUM(${assemblyUnits.qty}) FILTER (WHERE ${assemblyUnits.dispatched}), 0)::int`,
            })
            .from(assemblyUnits)
            .where(
              and(
                inArray(assemblyUnits.salesOrderId, soIds),
                isNull(assemblyUnits.deletedAt),
              ),
            )
            .groupBy(assemblyUnits.salesOrderId),
      bomIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: bomMasters.id,
              bomNo: bomMasters.bomNo,
              bomName: bomMasters.bomName,
              revision: bomMasters.revision,
            })
            .from(bomMasters)
            .where(and(inArray(bomMasters.id, bomIds), isNull(bomMasters.deletedAt))),
    ]);

    // Real dispatched qty per SO from the Customer Dispatch register (not the
    // legacy assembly_units.dispatched flag) — the list's Dispatched count must
    // agree with the detail page's reconciled rollup.
    const registerDispatchRows =
      soIds.length === 0
        ? []
        : await tx
            .select({
              soId: customerDispatches.salesOrderId,
              qty: sql<number>`COALESCE(SUM(${customerDispatchLines.qty}), 0)::int`,
            })
            .from(customerDispatchLines)
            .innerJoin(
              customerDispatches,
              eq(customerDispatches.id, customerDispatchLines.customerDispatchId),
            )
            .where(
              and(
                eq(customerDispatches.companyId, companyId),
                inArray(customerDispatches.salesOrderId, soIds),
                isNull(customerDispatches.deletedAt),
                isNull(customerDispatchLines.deletedAt),
              ),
            )
            .groupBy(customerDispatches.salesOrderId);
    const registerDispatchMap = new Map<string, number>();
    for (const r of registerDispatchRows) registerDispatchMap.set(r.soId, Number(r.qty));

    const orderQtyMap = new Map<string, number>();
    const dueDateMap = new Map<string, string | null>();
    for (const r of orderQtyRows) {
      orderQtyMap.set(r.soId, Number(r.orderQty));
      dueDateMap.set(r.soId, r.earliestDueDate ?? null);
    }
    const assembledMap = new Map<string, { assembled: number; inProgress: number; dispatched: number }>();
    for (const r of assembledAggRows) {
      assembledMap.set(r.soId, {
        assembled: Number(r.assembled),
        inProgress: Number(r.inProgress),
        dispatched: Number(r.dispatched),
      });
    }
    const bomCodeMap = new Map<string, { bomNo: string; bomName: string | null; revision: number | null }>();
    for (const r of bomCodes) {
      bomCodeMap.set(r.id, { bomNo: r.bomNo, bomName: r.bomName, revision: r.revision });
    }

    // ── Component readiness, batched across every SO on the page ──
    //
    // This list used to pass a hardcoded 0 as `canAssemble` into deriveStatus,
    // which only returns 'ready' when that argument is > 0 — so the Ready tile
    // always read 0, the "ALL READY ✓" badge was dead code, and an SO with
    // every component in stock was labelled "Waiting". That is the one question
    // this page exists to answer.
    //
    // Same math as getAssemblyTracker: per component
    // enoughForUnits = floor(max(stock, override) / qtyPerSet), and the SO's
    // canAssemble is the MIN across components. Batched into three queries for
    // the whole page (BOM lines, stock, overrides) rather than one round of
    // them per SO, so adding SOs costs rows, not round-trips.
    const readiness = await computeListReadiness(tx, companyId, soRows, orderQtyMap);

    const items = soRows.map((r) => {
      const orderQty = orderQtyMap.get(r.soId) ?? 0;
      const agg = assembledMap.get(r.soId);
      const assembledQty = agg?.assembled ?? 0;
      const inProgressQty = agg?.inProgress ?? 0;
      // Reconciled dispatched = legacy-flagged units + register dispatches
      // attributed to the remaining (un-flagged) completed units, capped at
      // assembled. Matches the detail page's FIFO reconciliation.
      const flaggedDispatched = agg?.dispatched ?? 0;
      const registerDispatched = registerDispatchMap.get(r.soId) ?? 0;
      const dispatchedQty =
        flaggedDispatched + Math.min(registerDispatched, Math.max(0, assembledQty - flaggedDispatched));
      const bom = r.bomMasterId ? bomCodeMap.get(r.bomMasterId) ?? null : null;
      const ready = readiness.get(r.soId) ?? { canAssemble: 0, readyCount: 0, totalCount: 0 };
      return {
        soId: r.soId,
        soCode: r.soCode,
        customerName: r.customerName,
        bomCode: bom?.bomNo ?? null,
        bomName: bom?.bomName ?? null,
        bomRevision: bom?.revision ?? null,
        partNoText: null,
        partName: null,
        orderQty,
        assembledQty,
        dispatchedQty,
        dueDate: dueDateMap.get(r.soId) ?? null,
        canAssemble: ready.canAssemble,
        readyCount: ready.readyCount,
        totalCount: ready.totalCount,
        status: deriveStatus(orderQty, assembledQty, inProgressQty, ready.canAssemble),
      };
    });

    return { generatedAt: new Date().toISOString(), items };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function markUnitAssembled(
  soId: string,
  input: MarkUnitAssembledInput,
  user: AuthContext,
): Promise<AssemblyUnitRow> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        type: salesOrders.type,
        bomMasterId: salesOrders.bomMasterId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);
    if (so.type !== 'equipment') {
      throw new ValidationError('Assembly tracker only applies to Equipment SOs');
    }

    const unitsRequired = await sumEquipmentLineQty(tx, soId);
    const requestedQty = Math.max(1, Math.round(input.qty ?? 1));

    // Already assembled (SUM qty across batch records) + the next batch number
    // (MAX unit_no + 1). Uniqueness on unit_no is enforced by a partial unique
    // index so a race surfaces as ConflictError on the insert.
    const aggRows = await tx
      .select({
        assembled: sql<number>`COALESCE(SUM(${assemblyUnits.qty}), 0)::int`,
        maxUnitNo: sql<number>`COALESCE(MAX(${assemblyUnits.unitNo}), 0)::int`,
      })
      .from(assemblyUnits)
      .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
    const alreadyAssembled = Number(aggRows[0]?.assembled ?? 0);
    const nextUnitNo = Number(aggRows[0]?.maxUnitNo ?? 0) + 1;

    // Guard 1 — never build more than the order still owes.
    const balance = unitsRequired > 0 ? Math.max(0, unitsRequired - alreadyAssembled) : requestedQty;
    if (unitsRequired > 0 && requestedQty > balance) {
      throw new ConflictError(
        `Cannot assemble ${requestedQty} — only ${balance} unit(s) remain on order (orderQty=${unitsRequired})`,
      );
    }

    // Guard 2 — never build more than the components on hand allow. This is the
    // cap the user asked for: qty may not exceed "Can Assemble". Stock already
    // reflects earlier assembles (the ledger was debited), so the min across
    // components is the additional-buildable count right now.
    const cap = await computeSoCanAssemble(tx, companyId, soId, so.bomMasterId ?? null, unitsRequired);
    if (cap.canAssemble < requestedQty) {
      throw new ConflictError(
        `Cannot assemble ${requestedQty} — only ${cap.canAssemble} buildable from stock` +
          (cap.bottleneck ? ` (short on ${cap.bottleneck})` : ''),
      );
    }

    // One serial for the whole batch. Auto-generated when the caller omits it.
    const serial = input.serialNo ?? `${so.code}-U${nextUnitNo}`;

    const inserted = await tx
      .insert(assemblyUnits)
      .values({
        companyId,
        salesOrderId: soId,
        soCodeText: so.code,
        unitNo: nextUnitNo,
        // One-shot assemble builds the units outright — a completed batch that
        // debits its components immediately (below), same as a Stop (ADR-129).
        status: 'completed',
        qty: requestedQty,
        serialNo: serial,
        assemblyDate: input.assemblyDate ?? todayIso(),
        assembledBy: input.assembledBy ?? null,
        remarks: input.remarks ?? null,
        bomMasterId: so.bomMasterId ?? null,
        dispatched: false,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const row = inserted[0]!;

    // ADR-115 — the components this batch swallowed leave the store (qtyPerSet ×
    // batch qty). Same tx as the unit insert, so a rollback unwinds both.
    // Skipped when this unit-no has already been debited (re-assemble after an
    // undo reuses the number).
    const alreadyDebited = await assemblyDebitExists(tx, companyId, so.code, nextUnitNo);
    const debited = alreadyDebited
      ? []
      : await applyAssemblyStockCascade(
          tx,
          {
            companyId,
            bomMasterId: so.bomMasterId ?? null,
            soCode: so.code,
            unitNo: nextUnitNo,
            qty: requestedQty,
            txnDate: row.assemblyDate,
          },
          user,
        );

    await emitActivityLog(
      tx,
      {
        action: 'ASSEMBLED',
        entity: 'AssemblyUnit',
        detail:
          `${so.code} — unit #${nextUnitNo}${requestedQty > 1 ? ` ×${requestedQty}` : ''} (S/N ${serial})` +
          (debited.length > 0 ? ` · ${debited.length} component(s) consumed` : ''),
        refId: so.code,
      },
      companyId,
      user,
    );

    // ADR-132 — close the order once every unit is built.
    await syncEquipmentSoClosure(tx, companyId, soId, so.code, user);

    return toUnitRow(row);
  });
}

// ── Start / Stop (ADR-129) ──────────────────────────────────────────────────

/**
 * START a batch — put `qty` units on the bench. Creates an `in_progress`
 * assembly_units row and moves NOTHING out of stock (the debit happens at STOP
 * for the good qty). Capped so committed (completed + in-progress) + qty never
 * exceeds the order.
 */
export async function startAssembly(
  soId: string,
  input: StartAssemblyInput,
  user: AuthContext,
): Promise<AssemblyUnitRow> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        type: salesOrders.type,
        bomMasterId: salesOrders.bomMasterId,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);
    if (so.type !== 'equipment') {
      throw new ValidationError('Assembly tracker only applies to Equipment SOs');
    }

    const unitsRequired = await sumEquipmentLineQty(tx, soId);
    const requestedQty = Math.max(1, Math.round(input.qty));

    // Committed = every non-deleted batch (completed AND in-progress). A start
    // may not push the committed total past the order.
    const aggRows = await tx
      .select({
        committed: sql<number>`COALESCE(SUM(${assemblyUnits.qty}), 0)::int`,
        maxUnitNo: sql<number>`COALESCE(MAX(${assemblyUnits.unitNo}), 0)::int`,
      })
      .from(assemblyUnits)
      .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
    const committed = Number(aggRows[0]?.committed ?? 0);
    const nextUnitNo = Number(aggRows[0]?.maxUnitNo ?? 0) + 1;

    const balance = unitsRequired > 0 ? Math.max(0, unitsRequired - committed) : requestedQty;
    if (unitsRequired > 0 && requestedQty > balance) {
      throw new ConflictError(
        `Cannot start ${requestedQty} — only ${balance} unit(s) remain on order (orderQty=${unitsRequired}).`,
      );
    }

    // No stock cascade: a start reserves nothing in the ledger. Components leave
    // the store at STOP, for the qty that actually came out good.
    const inserted = await tx
      .insert(assemblyUnits)
      .values({
        companyId,
        salesOrderId: soId,
        soCodeText: so.code,
        unitNo: nextUnitNo,
        status: 'in_progress',
        qty: requestedQty,
        serialNo: null,
        assemblyDate: input.startDate ?? todayIso(),
        assembledBy: input.startedBy ?? null,
        remarks: input.remarks ?? null,
        bomMasterId: so.bomMasterId ?? null,
        dispatched: false,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const row = inserted[0]!;

    await emitActivityLog(
      tx,
      {
        action: 'ASSEMBLY_START',
        entity: 'AssemblyUnit',
        detail: `${so.code} — started batch #${nextUnitNo} ×${requestedQty}`,
        refId: so.code,
      },
      companyId,
      user,
    );

    return toUnitRow(row);
  });
}

/**
 * STOP a started batch — `completedQty` units came out good. Spawns a normal
 * `completed` batch for that qty (which debits its components through the ADR-115
 * cascade, exactly like a one-shot assemble) and shrinks the in-progress batch
 * by the same amount; when the batch reaches 0 it is soft-deleted. The remainder
 * stays "in assembly" and can be completed by a later Stop.
 */
export async function stopAssembly(
  unitId: string,
  input: StopAssemblyInput,
  user: AuthContext,
): Promise<AssemblyUnitRow> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.id, unitId),
          eq(assemblyUnits.companyId, companyId),
          isNull(assemblyUnits.deletedAt),
        ),
      )
      .limit(1);
    const batch = existing[0];
    if (!batch) throw new NotFoundError(`Assembly unit ${unitId} not found`);
    if (batch.status !== 'in_progress') {
      throw new ConflictError(`Unit #${batch.unitNo} is not in progress — nothing to complete.`);
    }

    const remaining = batch.qty;
    const completedQty = Math.max(1, Math.round(input.completedQty));
    if (completedQty > remaining) {
      throw new ConflictError(
        `Cannot complete ${completedQty} — only ${remaining} left in this batch.`,
      );
    }

    const soId = batch.salesOrderId;
    const unitsRequired = await sumEquipmentLineQty(tx, soId);

    // Stock gate at STOP (not START): the good qty may not exceed what stock can
    // build right now. Stock reflects earlier completed debits; in-progress
    // batches debited nothing, so this is the true additional-buildable count.
    const cap = await computeSoCanAssemble(
      tx,
      companyId,
      soId,
      batch.bomMasterId ?? null,
      unitsRequired,
    );
    if (cap.canAssemble < completedQty) {
      throw new ConflictError(
        `Cannot complete ${completedQty} — only ${cap.canAssemble} buildable from stock` +
          (cap.bottleneck ? ` (short on ${cap.bottleneck})` : ''),
      );
    }

    // Next batch number for the completed row (above every existing unit_no).
    const maxRows = await tx
      .select({ maxUnitNo: sql<number>`COALESCE(MAX(${assemblyUnits.unitNo}), 0)::int` })
      .from(assemblyUnits)
      .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
    const nextUnitNo = Number(maxRows[0]?.maxUnitNo ?? 0) + 1;
    const serial = input.serialNo ?? `${batch.soCodeText}-U${nextUnitNo}`;

    // The completed batch — a normal assembly_units row that debits stock.
    const inserted = await tx
      .insert(assemblyUnits)
      .values({
        companyId,
        salesOrderId: soId,
        soCodeText: batch.soCodeText,
        unitNo: nextUnitNo,
        status: 'completed',
        qty: completedQty,
        serialNo: serial,
        assemblyDate: input.assemblyDate ?? todayIso(),
        assembledBy: input.assembledBy ?? null,
        remarks: input.remarks ?? null,
        bomMasterId: batch.bomMasterId ?? null,
        dispatched: false,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const completedRow = inserted[0]!;

    // ADR-115 debit for the good units (qtyPerSet × completedQty).
    const debited = await applyAssemblyStockCascade(
      tx,
      {
        companyId,
        bomMasterId: batch.bomMasterId ?? null,
        soCode: batch.soCodeText,
        unitNo: nextUnitNo,
        qty: completedQty,
        txnDate: completedRow.assemblyDate,
      },
      user,
    );

    // Shrink the in-progress batch; drop it once nothing is left to build.
    const newRemaining = remaining - completedQty;
    if (newRemaining <= 0) {
      await tx
        .update(assemblyUnits)
        .set({ deletedAt: new Date(), updatedBy: user.id })
        .where(eq(assemblyUnits.id, batch.id));
    } else {
      await tx
        .update(assemblyUnits)
        .set({ qty: newRemaining, updatedBy: user.id })
        .where(eq(assemblyUnits.id, batch.id));
    }

    await emitActivityLog(
      tx,
      {
        action: 'ASSEMBLED',
        entity: 'AssemblyUnit',
        detail:
          `${batch.soCodeText} — completed ${completedQty} of batch #${batch.unitNo} (S/N ${serial})` +
          (newRemaining > 0 ? ` · ${newRemaining} still in assembly` : '') +
          (debited.length > 0 ? ` · ${debited.length} component(s) consumed` : ''),
        refId: batch.soCodeText,
      },
      companyId,
      user,
    );

    // ADR-132 — a Stop is what turns WIP into finished units, so it can be the
    // one that completes the order.
    await syncEquipmentSoClosure(tx, companyId, soId, batch.soCodeText, user);

    return toUnitRow(completedRow);
  });
}

export async function markUnitDispatched(
  unitId: string,
  input: MarkUnitDispatchedInput,
  user: AuthContext,
): Promise<AssemblyUnitRow> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.id, unitId),
          eq(assemblyUnits.companyId, companyId),
          isNull(assemblyUnits.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`Assembly unit ${unitId} not found`);
    if (row.status !== 'completed') {
      throw new ConflictError(
        `Unit #${row.unitNo} is still in assembly — complete (Stop) it before dispatching.`,
      );
    }
    if (row.dispatched) {
      throw new ConflictError(`Unit #${row.unitNo} is already dispatched`);
    }

    const updated = await tx
      .update(assemblyUnits)
      .set({
        dispatched: true,
        dispatchDate: input.dispatchDate ?? todayIso(),
        dispatchedBy: input.dispatchedBy ?? null,
        dispatchRemarks: input.dispatchRemarks ?? null,
        updatedBy: user.id,
      })
      .where(eq(assemblyUnits.id, unitId))
      .returning();
    const after = updated[0]!;

    await emitActivityLog(
      tx,
      {
        action: 'DISPATCHED',
        entity: 'AssemblyUnit',
        detail: `${row.soCodeText} — unit #${row.unitNo}${row.qty > 1 ? ` ×${row.qty}` : ''}${row.serialNo ? ` (S/N ${row.serialNo})` : ''}`,
        refId: row.soCodeText,
      },
      companyId,
      user,
    );
    return toUnitRow(after);
  });
}

export async function undoLastUnit(
  soId: string,
  user: AuthContext,
): Promise<{ ok: true; removedUnitNo: number }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({ id: salesOrders.id, code: salesOrders.code })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);

    const latest = await tx
      .select()
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.salesOrderId, soId),
          isNull(assemblyUnits.deletedAt),
        ),
      )
      .orderBy(desc(assemblyUnits.unitNo))
      .limit(1);
    const row = latest[0];
    if (!row) throw new NotFoundError('No assembled units to undo');
    if (row.dispatched) {
      throw new ConflictError(
        `Cannot undo unit #${row.unitNo} — already dispatched. Reverse dispatch first.`,
      );
    }

    await tx
      .update(assemblyUnits)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(assemblyUnits.id, row.id));

    // ADR-115 — the unit is un-built, so its components go back on the shelf.
    // Replays the rows that assembly actually wrote rather than re-exploding
    // the BOM, so a BOM edited in between cannot unbalance the ledger.
    const returned = await reverseAssemblyStockCascade(
      tx,
      { companyId, soCode: so.code, unitNo: row.unitNo, txnDate: todayIso() },
      user,
    );

    await emitActivityLog(
      tx,
      {
        action: 'UNDO_ASSEMBLY',
        entity: 'AssemblyUnit',
        detail:
          `${so.code} — undo unit #${row.unitNo}` +
          (returned.length > 0 ? ` · ${returned.length} component(s) returned` : ''),
        refId: so.code,
      },
      companyId,
      user,
    );

    // ADR-132 — undoing a unit can drop the order back under its ordered qty;
    // reopen it so it returns to the tracker instead of staying closed.
    await syncEquipmentSoClosure(tx, companyId, soId, so.code, user);

    return { ok: true, removedUnitNo: row.unitNo };
  });
}

export async function setReadinessOverride(
  soId: string,
  childItemCode: string,
  input: SetReadinessOverrideInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({ id: salesOrders.id, code: salesOrders.code })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);

    // Resolve child item id if the code matches a known item (best-effort).
    const itemRows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), eq(items.code, childItemCode), isNull(items.deletedAt)),
      )
      .limit(1);
    const childItemId = itemRows[0]?.id ?? null;

    // Upsert. Soft-delete check first — if a soft-deleted row exists, revive it.
    const existing = await tx
      .select()
      .from(assemblyTracking)
      .where(
        and(
          eq(assemblyTracking.salesOrderId, soId),
          eq(assemblyTracking.childItemCode, childItemCode),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await tx
        .update(assemblyTracking)
        .set({
          readyQtyOverride: input.readyQtyOverride,
          remarks: input.remarks ?? null,
          childItemId,
          deletedAt: null,
          updatedBy: user.id,
        })
        .where(eq(assemblyTracking.id, existing[0].id));
    } else {
      await tx.insert(assemblyTracking).values({
        companyId,
        salesOrderId: soId,
        childItemCode,
        childItemId,
        readyQtyOverride: input.readyQtyOverride,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    await emitActivityLog(
      tx,
      {
        action: 'OVERRIDE_READY',
        entity: 'AssemblyTracking',
        detail: `${so.code} — ${childItemCode} ready=${input.readyQtyOverride}`,
        refId: so.code,
      },
      companyId,
      user,
    );

    return { ok: true };
  });
}

// ─── Internals ────────────────────────────────────────────────────────────

async function sumEquipmentLineQty(
  tx: Parameters<typeof withUserContext>[1] extends (tx: infer T) => unknown ? T : never,
  soId: string,
): Promise<number> {
  const r = await tx.execute(sql`
    SELECT COALESCE(SUM(order_qty), 0)::int AS q
    FROM public.sales_order_lines
    WHERE sales_order_id = ${soId}::uuid AND deleted_at IS NULL
  `);
  return Number((r as unknown as Array<{ q: number }>)[0]?.q ?? 0);
}

/**
 * Keep an Equipment SO's status a function of ASSEMBLY progress (ADR-132).
 *
 * Equipment SOs used to be closed by the op-entry sales cascade, which compares
 * what a job card PRODUCED against the SO line qty. On an equipment order those
 * are different units — the JC makes a BOM component, the line counts finished
 * equipment — so one component finishing closed the whole order and dropped it
 * off this tracker. The cascade now skips equipment SOs; closing happens here,
 * where the assembled count actually lives.
 *
 * Runs after every write that changes the completed count. Closes once assembled
 * covers ordered; reopens if an undo drops it back below — otherwise an undone
 * unit would leave the order closed and invisible on the very screen you undid
 * it from.
 *
 * Only ever flips open ⇄ closed. `draft`, `dispatched` and `cancelled` are
 * somebody's explicit decision, not an assembly state, so they're left alone.
 */
async function syncEquipmentSoClosure(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  soCode: string,
  user: AuthContext,
): Promise<void> {
  const unitsRequired = await sumEquipmentLineQty(tx, soId);
  // No lines / zero qty — nothing to measure against, so never auto-close.
  if (unitsRequired <= 0) return;

  // Completed batches only: an in-progress batch is still on the bench.
  const aggRows = await tx
    .select({
      assembled: sql<number>`COALESCE(SUM(${assemblyUnits.qty}) FILTER (WHERE ${assemblyUnits.status} = 'completed'), 0)::int`,
    })
    .from(assemblyUnits)
    .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
  const assembled = Number(aggRows[0]?.assembled ?? 0);

  const headerRows = await tx
    .select({ status: salesOrders.status })
    .from(salesOrders)
    .where(and(eq(salesOrders.id, soId), eq(salesOrders.companyId, companyId)))
    .limit(1);
  const current = headerRows[0]?.status;
  if (current !== 'open' && current !== 'closed') return;

  const shouldClose = assembled >= unitsRequired;
  // Already where it belongs — no update, no audit row, no updated_at thrash.
  if (shouldClose === (current === 'closed')) return;

  const nextStatus = shouldClose ? 'closed' : 'open';
  await tx
    .update(salesOrderLines)
    .set({ status: nextStatus, updatedBy: user.id })
    .where(
      and(
        eq(salesOrderLines.salesOrderId, soId),
        isNull(salesOrderLines.deletedAt),
        ne(salesOrderLines.status, 'cancelled'),
      ),
    );
  await tx
    .update(salesOrders)
    .set({ status: nextStatus, updatedBy: user.id })
    .where(eq(salesOrders.id, soId));

  await emitActivityLog(
    tx,
    {
      action: shouldClose ? 'SO_CLOSED' : 'SO_REOPENED',
      entity: 'SalesOrder',
      detail: shouldClose
        ? `${soCode} — All ${unitsRequired} unit(s) assembled`
        : `${soCode} — Reopened: ${assembled} of ${unitsRequired} unit(s) assembled`,
      refId: soCode,
    },
    companyId,
    user,
  );
}

/**
 * Component readiness for MANY SOs in three queries (BOM lines, stock,
 * overrides) — the list-page counterpart of the per-SO rollup inside
 * getAssemblyTracker, which is far too heavy to loop once per row.
 *
 * Returns, per SO: how many more units the stock on hand can build, and how
 * many of its components are fully covered (legacy's "Waiting — 3/7").
 *
 * An SO with no BOM, or a BOM with no lines, gets zeroes — matching legacy,
 * which drops such SOs from the tracker entirely (HTML L28678).
 */
async function computeListReadiness(
  tx: Parameters<typeof withUserContext>[1] extends (tx: infer T) => unknown ? T : never,
  companyId: string,
  soRows: Array<{ soId: string; bomMasterId: string | null }>,
  orderQtyMap: Map<string, number>,
): Promise<Map<string, { canAssemble: number; readyCount: number; totalCount: number }>> {
  const out = new Map<string, { canAssemble: number; readyCount: number; totalCount: number }>();
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const withBom = soRows.filter(
    (r): r is { soId: string; bomMasterId: string } =>
      r.bomMasterId !== null && UUID_RE.test(r.bomMasterId),
  );
  if (withBom.length === 0) return out;

  const bomIds = [...new Set(withBom.map((r) => r.bomMasterId))];
  const lineRows = await tx
    .select({
      bomMasterId: bomMasterLines.bomMasterId,
      childItemId: bomMasterLines.childItemId,
      childItemCode: items.code,
      qtyPerSet: bomMasterLines.qtyPerSet,
    })
    .from(bomMasterLines)
    .leftJoin(items, eq(items.id, bomMasterLines.childItemId))
    .where(and(inArray(bomMasterLines.bomMasterId, bomIds), isNull(bomMasterLines.deletedAt)));
  if (lineRows.length === 0) return out;

  const childIds = [...new Set(lineRows.map((l) => l.childItemId))];
  const soIds = withBom.map((r) => r.soId);
  const [stockRows, overrideRows] = await Promise.all([
    tx
      .select({ itemId: itemStockBalances.itemId, qty: itemStockBalances.onHandQty })
      .from(itemStockBalances)
      .where(
        and(eq(itemStockBalances.companyId, companyId), inArray(itemStockBalances.itemId, childIds)),
      ),
    tx
      .select({
        soId: assemblyTracking.salesOrderId,
        code: assemblyTracking.childItemCode,
        qty: assemblyTracking.readyQtyOverride,
      })
      .from(assemblyTracking)
      .where(
        and(
          eq(assemblyTracking.companyId, companyId),
          inArray(assemblyTracking.salesOrderId, soIds),
          isNull(assemblyTracking.deletedAt),
        ),
      ),
  ]);

  const stockMap = new Map<string, number>();
  for (const r of stockRows) stockMap.set(r.itemId, Number(r.qty));
  // Overrides are keyed (so, childCode) — the same composite the per-SO path uses.
  const overrideMap = new Map<string, number>();
  for (const r of overrideRows) overrideMap.set(`${r.soId}::${r.code}`, r.qty);

  const linesByBom = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    const arr = linesByBom.get(l.bomMasterId);
    if (arr) arr.push(l);
    else linesByBom.set(l.bomMasterId, [l]);
  }

  for (const so of withBom) {
    const lines = linesByBom.get(so.bomMasterId);
    if (!lines || lines.length === 0) continue;
    const unitsRequired = orderQtyMap.get(so.soId) ?? 0;
    let min = Infinity;
    let readyCount = 0;
    for (const l of lines) {
      const qtyPerSet = Number(l.qtyPerSet);
      const totalNeed = Math.round(qtyPerSet * unitsRequired);
      const stockQty = Math.max(0, Math.floor(stockMap.get(l.childItemId) ?? 0));
      const autoReadyQty = Math.min(stockQty, totalNeed);
      const overrideQty = overrideMap.get(`${so.soId}::${l.childItemCode ?? '—'}`) ?? 0;
      const finalReadyQty = Math.max(autoReadyQty, overrideQty);
      if (finalReadyQty >= totalNeed) readyCount++;
      const enoughForUnits = qtyPerSet > 0 ? Math.floor(finalReadyQty / qtyPerSet) : 0;
      if (enoughForUnits < min) min = enoughForUnits;
    }
    out.set(so.soId, {
      canAssemble: min === Infinity ? 0 : Math.max(0, min),
      readyCount,
      totalCount: lines.length,
    });
  }
  return out;
}

/**
 * How many MORE units this SO can build from components on hand right now —
 * min(floor(finalReady / qtyPerSet)) across the BOM, plus the bottleneck code.
 * Same math as getAssemblyTracker's rollup, isolated so markUnitAssembled can
 * enforce the batch-qty cap server-side (Rule 1 — the gate lives here, not the
 * browser). Stock reflects earlier assembles because the ledger is debited each
 * build, so this is the additional-buildable count, not the original order size.
 */
async function computeSoCanAssemble(
  tx: Parameters<typeof withUserContext>[1] extends (tx: infer T) => unknown ? T : never,
  companyId: string,
  soId: string,
  bomMasterId: string | null,
  unitsRequired: number,
): Promise<{ canAssemble: number; bottleneck: string | null }> {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!bomMasterId || !UUID_RE.test(bomMasterId)) return { canAssemble: 0, bottleneck: null };

  const childRows = await tx
    .select({
      childItemId: bomMasterLines.childItemId,
      childItemCode: items.code,
      qtyPerSet: bomMasterLines.qtyPerSet,
    })
    .from(bomMasterLines)
    .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
    .where(and(eq(bomMasterLines.bomMasterId, bomMasterId), isNull(bomMasterLines.deletedAt)));
  if (childRows.length === 0) return { canAssemble: 0, bottleneck: null };

  const childIds = childRows.map((r) => r.childItemId);
  const stockMap = new Map<string, number>();
  const stockRows = await tx
    .select({ itemId: itemStockBalances.itemId, qty: itemStockBalances.onHandQty })
    .from(itemStockBalances)
    .where(
      and(eq(itemStockBalances.companyId, companyId), inArray(itemStockBalances.itemId, childIds)),
    );
  for (const r of stockRows) stockMap.set(r.itemId, Number(r.qty));

  const overrideMap = await fetchOverrideMap(tx, companyId, soId);

  let min = Infinity;
  let bottleneck: string | null = null;
  for (const r of childRows) {
    const code = r.childItemCode ?? '—';
    const qtyPerSet = Number(r.qtyPerSet);
    const totalNeed = Math.round(qtyPerSet * unitsRequired);
    const stockQty = Math.max(0, Math.floor(stockMap.get(r.childItemId) ?? 0));
    const autoReadyQty = Math.min(stockQty, totalNeed);
    const overrideQty = overrideMap.get(code) ?? 0;
    const finalReadyQty = Math.max(autoReadyQty, overrideQty);
    const enoughForUnits = qtyPerSet > 0 ? Math.floor(finalReadyQty / qtyPerSet) : 0;
    if (enoughForUnits < min) {
      min = enoughForUnits;
      bottleneck = code;
    }
  }
  return { canAssemble: min === Infinity ? 0 : Math.max(0, min), bottleneck };
}

async function fetchOverrideMap(
  tx: Parameters<typeof withUserContext>[1] extends (tx: infer T) => unknown ? T : never,
  companyId: string,
  soId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ code: assemblyTracking.childItemCode, qty: assemblyTracking.readyQtyOverride })
    .from(assemblyTracking)
    .where(
      and(
        eq(assemblyTracking.companyId, companyId),
        eq(assemblyTracking.salesOrderId, soId),
        isNull(assemblyTracking.deletedAt),
      ),
    );
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.code, r.qty);
  return m;
}

function toUnitRow(row: typeof assemblyUnits.$inferSelect): AssemblyUnitRow {
  return {
    id: row.id,
    unitNo: row.unitNo,
    status: row.status as AssemblyUnitStatus,
    qty: row.qty,
    serialNo: row.serialNo,
    assemblyDate: row.assemblyDate,
    assembledBy: row.assembledBy,
    remarks: row.remarks,
    dispatched: row.dispatched,
    dispatchDate: row.dispatchDate,
    dispatchedBy: row.dispatchedBy,
    dispatchRemarks: row.dispatchRemarks,
  };
}

// ── Related Documents (read-only traceability) ─────────────────────────────
//
// The Assembly Tracker is SO-scoped: its detail route is /assemblies/$soId and
// the anchor id IS a sales_orders id. There is no assembly_unit "header" — the
// units are terminal, so downstream is always empty. We surface where the
// assembly came FROM:
//   Upstream:
//     - the Sales Order itself (the anchor SO row)
//     - DISTINCT bom_masters referenced by this SO's assembly_units.bom_master_id
// Every subquery is company-scoped and soft-delete filtered, inside a single
// withUserContext transaction so RLS company isolation also applies.
export async function getAssemblyRelated(
  soId: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the anchor SO is visible before gathering related docs.
    const headers = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        status: salesOrders.status,
        soDate: salesOrders.soDate,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Sales order ${soId} not found`);

    // ── Upstream: distinct BOM masters referenced by this SO's assembly units ─
    const unitBomRows = await tx
      .selectDistinct({ bomMasterId: assemblyUnits.bomMasterId })
      .from(assemblyUnits)
      .where(
        and(
          eq(assemblyUnits.salesOrderId, soId),
          eq(assemblyUnits.companyId, companyId),
          isNull(assemblyUnits.deletedAt),
        ),
      );
    const bomMasterIds = Array.from(
      new Set(unitBomRows.map((r) => r.bomMasterId).filter((v): v is string => Boolean(v))),
    );
    const bomRows =
      bomMasterIds.length === 0
        ? []
        : await tx
            .select({
              id: bomMasters.id,
              code: bomMasters.bomNo,
              status: bomMasters.status,
              date: bomMasters.revisionDate,
            })
            .from(bomMasters)
            .where(
              and(
                eq(bomMasters.companyId, companyId),
                isNull(bomMasters.deletedAt),
                inArray(bomMasters.id, bomMasterIds),
              ),
            )
            .orderBy(asc(bomMasters.bomNo));

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedDoc => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream sections (what this assembly was built FROM) ────────────────
    // The anchor SO row itself — linkId null so the row's own id (= the SO id)
    // drives the /sales-orders/$id route.
    const soSection = section('sales-order', 'Sales Order', '📄', 'sales-order', [
      row(header.id, header.code, header.status, header.soDate),
    ]);
    const bomSection = section(
      'bom-master',
      'BOM Masters',
      '📐',
      'bom-master',
      bomRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );

    const upstream = [soSection, bomSection];
    // Assembly units are terminal — no downstream documents.
    const downstream: RelatedSection[] = [];

    return {
      self: { module: 'assembly', code: header.code },
      upstream,
      downstream,
      related: [],
      // The anchor has no standalone creation event distinct from the SO (which
      // is already an upstream section), so pass null and let the timeline be
      // built from the SO + BOM upstream rows to avoid duplicating the SO event.
      timeline: buildTimeline(null, [...upstream, ...downstream]),
    };
  });
}
