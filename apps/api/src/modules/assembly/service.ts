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
//   shortfall     = max(0, totalNeed - finalReady)
//   enoughForUnits = floor(finalReady / qtyPerSet)
//
// Rollup:
//   canAssemble   = min(enoughForUnits) across all components
//   bottleneck    = component with the minimum enoughForUnits
//   assembledQty  = count of non-deleted assembly_units
//   dispatchedQty = count of assembled units with dispatched=true
//   status        = done (assembledQty >= orderQty)
//                 | assembling (assembledQty > 0)
//                 | ready (canAssemble > 0 and assembledQty == 0)
//                 | waiting (otherwise)

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  AssemblyComponentRow,
  AssemblyComponentStatus,
  AssemblyListResponse,
  AssemblyTrackerResponse,
  AssemblyUnitRow,
  MarkUnitAssembledInput,
  MarkUnitDispatchedInput,
  SetReadinessOverrideInput,
} from '@innovic/shared';
import {
  assemblyTracking,
  assemblyUnits,
  bomMasterLines,
  bomMasters,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveStatus(orderQty: number, assembledQty: number, canAssemble: number): 'waiting' | 'ready' | 'assembling' | 'done' {
  if (orderQty > 0 && assembledQty >= orderQty) return 'done';
  if (assembledQty > 0) return 'assembling';
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
        const shortfall = Math.max(0, totalNeed - finalReadyQty);
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

    // Assembled units
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
    const units = unitRows.map(toUnitRow);

    const assembledQty = units.length;
    const dispatchedQty = units.filter((u) => u.dispatched).length;

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
      // Headroom is what we can ADD on top of what's already assembled — the
      // legacy semantic. Actual stock-deduction lifecycle is the user's call
      // (assembly_units.deductions snapshot it).
      canAssembleAdditional = Math.max(
        0,
        Math.min(min === Infinity ? 0 : min, Math.max(0, unitsRequired - assembledQty)),
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
        dispatchedQty,
        balanceQty: Math.max(0, unitsRequired - assembledQty),
        canAssembleAdditional,
        bottleneck,
        status: deriveStatus(unitsRequired, assembledQty, canAssembleAdditional),
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
              assembled: sql<number>`COUNT(*)::int`,
              dispatched: sql<number>`COUNT(*) FILTER (WHERE ${assemblyUnits.dispatched})::int`,
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
            .select({ id: bomMasters.id, bomNo: bomMasters.bomNo })
            .from(bomMasters)
            .where(and(inArray(bomMasters.id, bomIds), isNull(bomMasters.deletedAt))),
    ]);

    const orderQtyMap = new Map<string, number>();
    for (const r of orderQtyRows) orderQtyMap.set(r.soId, Number(r.orderQty));
    const assembledMap = new Map<string, { assembled: number; dispatched: number }>();
    for (const r of assembledAggRows) {
      assembledMap.set(r.soId, {
        assembled: Number(r.assembled),
        dispatched: Number(r.dispatched),
      });
    }
    const bomCodeMap = new Map<string, string>();
    for (const r of bomCodes) bomCodeMap.set(r.id, r.bomNo);

    const items = soRows.map((r) => {
      const orderQty = orderQtyMap.get(r.soId) ?? 0;
      const agg = assembledMap.get(r.soId);
      const assembledQty = agg?.assembled ?? 0;
      const dispatchedQty = agg?.dispatched ?? 0;
      return {
        soId: r.soId,
        soCode: r.soCode,
        customerName: r.customerName,
        bomCode: r.bomMasterId ? bomCodeMap.get(r.bomMasterId) ?? null : null,
        partNoText: null,
        partName: null,
        orderQty,
        assembledQty,
        dispatchedQty,
        status: deriveStatus(orderQty, assembledQty, 0),
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

    // Compute next unitNo via SELECT MAX (uniqueness is enforced by partial
    // unique index so a race would surface as ConflictError on the insert).
    const maxRows = await tx
      .select({ m: sql<number>`COALESCE(MAX(${assemblyUnits.unitNo}), 0)::int` })
      .from(assemblyUnits)
      .where(and(eq(assemblyUnits.salesOrderId, soId), isNull(assemblyUnits.deletedAt)));
    const nextUnitNo = Number(maxRows[0]?.m ?? 0) + 1;

    if (nextUnitNo > unitsRequired && unitsRequired > 0) {
      throw new ConflictError(
        `Cannot assemble more units than required (orderQty=${unitsRequired})`,
      );
    }

    const inserted = await tx
      .insert(assemblyUnits)
      .values({
        companyId,
        salesOrderId: soId,
        soCodeText: so.code,
        unitNo: nextUnitNo,
        serialNo: input.serialNo ?? null,
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

    await emitActivityLog(
      tx,
      {
        action: 'ASSEMBLED',
        entity: 'AssemblyUnit',
        detail: `${so.code} — unit #${nextUnitNo}${input.serialNo ? ` (S/N ${input.serialNo})` : ''}`,
        refId: so.code,
      },
      companyId,
      user,
    );

    return toUnitRow(row);
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
        detail: `${row.soCodeText} — unit #${row.unitNo}${row.serialNo ? ` (S/N ${row.serialNo})` : ''}`,
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

    await emitActivityLog(
      tx,
      {
        action: 'UNDO_ASSEMBLY',
        entity: 'AssemblyUnit',
        detail: `${so.code} — undo unit #${row.unitNo}`,
        refId: so.code,
      },
      companyId,
      user,
    );

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
