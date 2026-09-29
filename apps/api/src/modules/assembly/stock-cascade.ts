// Assembly stock moves (ADR-115, reshaped by ADR-193 phase 3c).
//
// ADR-193 3c: the components of an assembly SO leave the store when they are
// ISSUED against the SO (Item Issue), not when a unit is completed. Complete
// only FITS parts already out (assembly_unit_consumptions, fitting.ts) — so
// the old component OUT that used to run here is retired. assembly_units had
// 0 rows on TEST and PROD when it was retired, so no unit was ever debited by
// it; the undo replay below still reverses any such row if one exists.
//
// What stays: the finished good this BOM produces (bom_masters.parent_item_id)
// arrives on the shelf when a unit is completed — one IN of `qty` pcs, tagged
// "<SO> unit #N (output)" so Undo can find and reverse just that credit.
//
// Runs in the SAME tx as the unit insert, so a rollback unwinds both.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { bomMasters, storeTransactions } from '../../db/schema';
import { postStockMove } from '../../lib/stock-ledger';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

export interface AssemblyStockContext {
  companyId: string;
  /** BOM of the unit; its parent item is the finished good. Null → no credit. */
  bomMasterId: string | null;
  /** SO code + unit no, for the ledger's source_ref. */
  soCode: string;
  unitNo: number;
  /** Batch quantity — how many units this record builds (pcs credited). */
  qty: number;
  /** YYYY-MM-DD — the unit's assembly date, so the ledger matches the build. */
  txnDate: string;
}

export interface AssemblyStockLine {
  itemId: string;
  qty: number;
  stockBefore: number;
  stockAfter: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The finished good this BOM builds (bom_masters.parent_item_id). Null when the
 *  BOM predates the column (six legacy BOMs) — then there is no item to credit
 *  and the output step is skipped. */
async function loadParentItemId(tx: DbTransaction, bomMasterId: string): Promise<string | null> {
  const rows = await tx
    .select({ parentItemId: bomMasters.parentItemId })
    .from(bomMasters)
    .where(and(eq(bomMasters.id, bomMasterId), isNull(bomMasters.deletedAt)))
    .limit(1);
  return rows[0]?.parentItemId ?? null;
}

/** Net finished-good credit still standing for one unit no.: every
 *  "(output)" IN minus every "(output) undo" OUT. A unit no. is reused after an
 *  Undo, so the raw IN rows alone would over-count. */
async function outputNetByItem(
  tx: DbTransaction,
  companyId: string,
  sourceRef: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      itemId: storeTransactions.itemId,
      qty: storeTransactions.qty,
      txnType: storeTransactions.txnType,
      ref: storeTransactions.sourceRef,
    })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.companyId, companyId),
        eq(storeTransactions.sourceType, 'assembly'),
        inArray(storeTransactions.sourceRef, [
          `${sourceRef} (output)`,
          `${sourceRef} (output) undo`,
        ]),
      ),
    );
  const net = new Map<string, number>();
  for (const r of rows) {
    if (r.itemId === null) continue;
    const sign = r.txnType === 'in' && r.ref === `${sourceRef} (output)` ? 1 : -1;
    net.set(r.itemId, (net.get(r.itemId) ?? 0) + sign * r.qty);
  }
  return net;
}

/**
 * Credit the finished good for a completed unit (one IN of `qty` pcs of the
 * BOM's parent item). No-op without a BOM / parent item, or when this unit no.
 * still carries an un-undone credit (replaces the old assemblyDebitExists
 * guard, which looked for component OUT rows that are no longer written).
 * Returns the qty credited (0 when skipped).
 */
export async function postAssemblyOutput(
  tx: DbTransaction,
  ctx: AssemblyStockContext,
  user: AuthContext,
): Promise<number> {
  if (!ctx.bomMasterId || !UUID_RE.test(ctx.bomMasterId)) return 0;
  const parentItemId = await loadParentItemId(tx, ctx.bomMasterId);
  if (!parentItemId) return 0;
  const sourceRef = `${ctx.soCode} unit #${ctx.unitNo}`;
  const net = await outputNetByItem(tx, ctx.companyId, sourceRef);
  if ([...net.values()].some((q) => q > 0)) return 0;
  const batchQty = Math.max(1, Math.round(ctx.qty));
  await postStockMove(tx, {
    companyId: ctx.companyId,
    itemId: parentItemId,
    txnType: 'in',
    qty: batchQty,
    sourceType: 'assembly',
    sourceRef: `${sourceRef} (output)`,
    remarks: `Assembly output · unit #${ctx.unitNo} · ${batchQty} pcs built`,
    txnDate: ctx.txnDate,
    userId: user.id,
    itemCodeText: null,
    guard: 'none',
  });
  return batchQty;
}

/**
 * Undo Last Unit — reverse the stock rows this unit no. actually wrote.
 *
 * Replays the ledger rather than re-exploding the BOM, so a BOM edited between
 * assembling and undoing cannot unbalance it (same reasoning as the JW-return
 * cancel path, ADR-109). Both halves are NETTED against earlier undo rows of
 * the same unit no. (a unit no. is reused after an Undo):
 *   - legacy component OUT rows ("<SO> unit #N") — none are written since
 *     ADR-193 3c; any pre-3c row is credited back once;
 *   - the finished-good "(output)" IN — taken back OUT.
 * Append-only: compensating rows, never a delete. Returns the legacy
 * component credits (normally empty).
 */
export async function reverseAssemblyStockCascade(
  tx: DbTransaction,
  ctx: Pick<AssemblyStockContext, 'companyId' | 'soCode' | 'unitNo' | 'txnDate'>,
  user: AuthContext,
): Promise<AssemblyStockLine[]> {
  const sourceRef = `${ctx.soCode} unit #${ctx.unitNo}`;
  const legacyRows = await tx
    .select({
      itemId: storeTransactions.itemId,
      qty: storeTransactions.qty,
      txnType: storeTransactions.txnType,
      ref: storeTransactions.sourceRef,
    })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.companyId, ctx.companyId),
        eq(storeTransactions.sourceType, 'assembly'),
        inArray(storeTransactions.sourceRef, [sourceRef, `${sourceRef} (undo)`]),
      ),
    );
  const netByItem = new Map<string, number>();
  for (const r of legacyRows) {
    if (r.itemId === null) continue;
    const sign = r.txnType === 'out' && r.ref === sourceRef ? 1 : r.txnType === 'in' ? -1 : 0;
    netByItem.set(r.itemId, (netByItem.get(r.itemId) ?? 0) + sign * r.qty);
  }

  const written: AssemblyStockLine[] = [];
  for (const [itemId, qty] of [...netByItem].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (qty <= 0) continue;
    const moved = await postStockMove(tx, {
      companyId: ctx.companyId,
      itemId,
      txnType: 'in',
      qty,
      sourceType: 'assembly',
      sourceRef: `${sourceRef} (undo)`,
      remarks: `Assembly undo · unit #${ctx.unitNo} · ${qty} pcs returned`,
      txnDate: ctx.txnDate,
      userId: user.id,
      itemCodeText: null,
      guard: 'none',
    });
    written.push({ itemId, qty, stockBefore: moved.stockBefore, stockAfter: moved.stockAfter });
  }

  // The unit is un-built, so its finished good leaves the shelf again.
  const outNet = await outputNetByItem(tx, ctx.companyId, sourceRef);
  for (const [itemId, qty] of [...outNet].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (qty <= 0) continue;
    await postStockMove(tx, {
      companyId: ctx.companyId,
      itemId,
      txnType: 'out',
      qty,
      sourceType: 'assembly',
      sourceRef: `${sourceRef} (output) undo`,
      remarks: `Assembly undo · unit #${ctx.unitNo} · ${qty} pcs finished good removed`,
      txnDate: ctx.txnDate,
      userId: user.id,
      itemCodeText: null,
      guard: 'none',
    });
  }

  return written;
}
