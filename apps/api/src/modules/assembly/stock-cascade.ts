// Assembly stock cascade (ADR-115).
//
// Assembling one unit of an Equipment SO physically empties the shelf — build a
// Rotator and a PAWL plus a SUPPORT leave the store. Until this file existed,
// markUnitAssembled wrote the unit row and an audit row and nothing else, so
// component stock never moved. Parts already inside finished machines still
// counted as free, and the tracker kept offering to build more units out of
// them (see 0091_store_txn_assembly.sql for the live evidence).
//
// A build is TWO stock moves, not one: the child components leave the store
// (OUT), and the finished good this BOM produces — bom_masters.parent_item_id —
// arrives on the shelf (IN, `qty` pcs of the assembled item). The parent credit
// is tagged with an "(output)" source_ref so the undo path finds and reverses it
// on its own, without disturbing the child debits.
//
// Mirrors the shape of op-entry/qc-stock-cascade.ts and the GRN cascade: lock
// the items row FOR UPDATE to serialise concurrent writes on the same item,
// read on-hand from v_item_stock, then insert the ledger row with
// stockBefore/stockAfter stamped.
//
// Runs in the SAME tx as the unit insert, so a rollback unwinds both.
//
// NOT a stock GATE. A short component does not block assembly here — the live
// data already carries a component at -1, so refusing to assemble would stop
// the floor working on day one. The debit is honest either way: on-hand simply
// goes negative and says so. Gating is a separate decision, taken once the
// opening balances have been counted and corrected.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { bomMasterLines, bomMasters, storeTransactions } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

export interface AssemblyStockContext {
  companyId: string;
  /** BOM whose components this unit consumes. Null → nothing to debit. */
  bomMasterId: string | null;
  /** SO code + unit no, for the ledger's source_ref. */
  soCode: string;
  unitNo: number;
  /** Batch quantity — how many units this record builds. Each BOM line's
   *  qtyPerSet is multiplied by this, so a batch of 5 debits 5 sets. Default 1. */
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

/** Components consumed by ONE unit: each BOM line's qtyPerSet, rounded. */
async function loadPerUnitComponents(
  tx: DbTransaction,
  bomMasterId: string,
): Promise<Array<{ itemId: string; qty: number }>> {
  const rows = await tx
    .select({ childItemId: bomMasterLines.childItemId, qtyPerSet: bomMasterLines.qtyPerSet })
    .from(bomMasterLines)
    .where(and(eq(bomMasterLines.bomMasterId, bomMasterId), isNull(bomMasterLines.deletedAt)));
  return rows
    .map((r) => ({ itemId: r.childItemId, qty: Math.round(Number(r.qtyPerSet)) }))
    .filter((r) => r.qty > 0);
}

/** The finished good this BOM builds (bom_masters.parent_item_id). Null when the
 *  BOM predates the column (six legacy BOMs) — then there is no item to credit
 *  and the output step is skipped. */
async function loadParentItemId(
  tx: DbTransaction,
  bomMasterId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ parentItemId: bomMasters.parentItemId })
    .from(bomMasters)
    .where(and(eq(bomMasters.id, bomMasterId), isNull(bomMasters.deletedAt)))
    .limit(1);
  return rows[0]?.parentItemId ?? null;
}

/** Read on-hand for one item, locking its items row first. */
async function lockAndRead(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<number> {
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);
  const rows = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  return Number(rows[0]?.on_hand ?? 0);
}

/**
 * Debit every BOM component for one assembled unit. No-op when the SO carries
 * no BOM (or a legacy non-UUID bom_master_id) or the BOM has no lines.
 */
export async function applyAssemblyStockCascade(
  tx: DbTransaction,
  ctx: AssemblyStockContext,
  user: AuthContext,
): Promise<AssemblyStockLine[]> {
  if (!ctx.bomMasterId || !UUID_RE.test(ctx.bomMasterId)) return [];
  const perUnit = await loadPerUnitComponents(tx, ctx.bomMasterId);
  if (perUnit.length === 0) return [];

  // Batch multiplier: a record of qty N consumes N sets of every component.
  const batchQty = Math.max(1, Math.round(ctx.qty));
  const components = perUnit.map((c) => ({ itemId: c.itemId, qty: c.qty * batchQty }));

  const written: AssemblyStockLine[] = [];
  // Sorted by itemId so two concurrent assembles take the row locks in the same
  // order and cannot deadlock against each other.
  for (const c of [...components].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const stockBefore = await lockAndRead(tx, ctx.companyId, c.itemId);
    const stockAfter = stockBefore - c.qty;
    await tx.insert(storeTransactions).values({
      companyId: ctx.companyId,
      txnDate: ctx.txnDate,
      itemId: c.itemId,
      txnType: 'out',
      qty: c.qty,
      sourceType: 'assembly',
      sourceRef: `${ctx.soCode} unit #${ctx.unitNo}`,
      stockBefore,
      stockAfter,
      remarks: `Assembly consume · unit #${ctx.unitNo} · ${c.qty} pcs`,
      createdBy: user.id,
    });
    written.push({ itemId: c.itemId, qty: c.qty, stockBefore, stockAfter });
  }

  // The finished good this build produced goes ON the shelf: one IN for the
  // BOM's parent item, `batchQty` pcs. Tagged "(output)" so reverseAssembly can
  // find and undo just this credit. Skipped when the BOM has no parent item.
  const parentItemId = await loadParentItemId(tx, ctx.bomMasterId);
  if (parentItemId) {
    const stockBefore = await lockAndRead(tx, ctx.companyId, parentItemId);
    const stockAfter = stockBefore + batchQty;
    await tx.insert(storeTransactions).values({
      companyId: ctx.companyId,
      txnDate: ctx.txnDate,
      itemId: parentItemId,
      txnType: 'in',
      qty: batchQty,
      sourceType: 'assembly',
      sourceRef: `${ctx.soCode} unit #${ctx.unitNo} (output)`,
      stockBefore,
      stockAfter,
      remarks: `Assembly output · unit #${ctx.unitNo} · ${batchQty} pcs built`,
      createdBy: user.id,
    });
  }

  return written;
}

/**
 * Undo Last Unit — put the components back.
 *
 * Replays the rows this unit's assembly actually wrote rather than re-exploding
 * the BOM, so a BOM edited between assembling and undoing cannot leave the
 * ledger unbalanced. Same reasoning as the JW-return cancel path (ADR-109).
 * Append-only: a compensating IN, never a delete.
 */
export async function reverseAssemblyStockCascade(
  tx: DbTransaction,
  ctx: Pick<AssemblyStockContext, 'companyId' | 'soCode' | 'unitNo' | 'txnDate'>,
  user: AuthContext,
): Promise<AssemblyStockLine[]> {
  const sourceRef = `${ctx.soCode} unit #${ctx.unitNo}`;
  const priorRows = await tx
    .select({ itemId: storeTransactions.itemId, qty: storeTransactions.qty })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.companyId, ctx.companyId),
        eq(storeTransactions.sourceType, 'assembly'),
        eq(storeTransactions.sourceRef, sourceRef),
        eq(storeTransactions.txnType, 'out'),
      ),
    );
  if (priorRows.length === 0) return [];

  // Net per item, so an undo after a re-assemble of the same unit no. cannot
  // credit back more than was ever taken.
  // storeTransactions.itemId is nullable on the table; an assembly debit always
  // sets it, but narrow rather than assert.
  const netByItem = new Map<string, number>();
  for (const r of priorRows) {
    if (r.itemId === null) continue;
    netByItem.set(r.itemId, (netByItem.get(r.itemId) ?? 0) + r.qty);
  }

  const written: AssemblyStockLine[] = [];
  for (const [itemId, qty] of [...netByItem].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (qty <= 0) continue;
    const stockBefore = await lockAndRead(tx, ctx.companyId, itemId);
    const stockAfter = stockBefore + qty;
    await tx.insert(storeTransactions).values({
      companyId: ctx.companyId,
      txnDate: ctx.txnDate,
      itemId,
      txnType: 'in',
      qty,
      sourceType: 'assembly',
      sourceRef: `${sourceRef} (undo)`,
      stockBefore,
      stockAfter,
      remarks: `Assembly undo · unit #${ctx.unitNo} · ${qty} pcs returned`,
      createdBy: user.id,
    });
    written.push({ itemId, qty, stockBefore, stockAfter });
  }

  // Reverse the finished-good output credit (the "(output)" IN row) — the unit
  // is un-built, so its finished good leaves the shelf again. Mirror of the
  // credit in applyAssemblyStockCascade; a compensating OUT, never a delete.
  const outputRef = `${sourceRef} (output)`;
  const outputRows = await tx
    .select({ itemId: storeTransactions.itemId, qty: storeTransactions.qty })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.companyId, ctx.companyId),
        eq(storeTransactions.sourceType, 'assembly'),
        eq(storeTransactions.sourceRef, outputRef),
        eq(storeTransactions.txnType, 'in'),
      ),
    );
  const outNetByItem = new Map<string, number>();
  for (const r of outputRows) {
    if (r.itemId === null) continue;
    outNetByItem.set(r.itemId, (outNetByItem.get(r.itemId) ?? 0) + r.qty);
  }
  for (const [itemId, qty] of [...outNetByItem].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (qty <= 0) continue;
    const stockBefore = await lockAndRead(tx, ctx.companyId, itemId);
    const stockAfter = stockBefore - qty;
    await tx.insert(storeTransactions).values({
      companyId: ctx.companyId,
      txnDate: ctx.txnDate,
      itemId,
      txnType: 'out',
      qty,
      sourceType: 'assembly',
      sourceRef: `${outputRef} undo`,
      stockBefore,
      stockAfter,
      remarks: `Assembly undo · unit #${ctx.unitNo} · ${qty} pcs finished good removed`,
      createdBy: user.id,
    });
  }

  return written;
}

/** Guard: has this unit-no already been debited? Keeps a re-assemble after an
 *  undo from double-debiting when the unit number is reused. */
export async function assemblyDebitExists(
  tx: DbTransaction,
  companyId: string,
  soCode: string,
  unitNo: number,
): Promise<boolean> {
  const rows = await tx
    .select({ id: storeTransactions.id })
    .from(storeTransactions)
    .where(
      and(
        eq(storeTransactions.companyId, companyId),
        eq(storeTransactions.sourceType, 'assembly'),
        eq(storeTransactions.sourceRef, `${soCode} unit #${unitNo}`),
        eq(storeTransactions.txnType, 'out'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
