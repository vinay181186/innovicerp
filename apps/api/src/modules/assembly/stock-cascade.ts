// Assembly stock cascade (ADR-115).
//
// Assembling one unit of an Equipment SO physically empties the shelf — build a
// Rotator and a PAWL plus a SUPPORT leave the store. Until this file existed,
// markUnitAssembled wrote the unit row and an audit row and nothing else, so
// component stock never moved. Parts already inside finished machines still
// counted as free, and the tracker kept offering to build more units out of
// them (see 0091_store_txn_assembly.sql for the live evidence).
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
import { bomMasterLines, storeTransactions } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

export interface AssemblyStockContext {
  companyId: string;
  /** BOM whose components this unit consumes. Null → nothing to debit. */
  bomMasterId: string | null;
  /** SO code + unit no, for the ledger's source_ref. */
  soCode: string;
  unitNo: number;
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
  const components = await loadPerUnitComponents(tx, ctx.bomMasterId);
  if (components.length === 0) return [];

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
