// The ONE writer of stock ledger rows (ADR-193 phase 1a).
//
// Every movement — receipt, issue, return, dispatch, production credit,
// assembly, stock count — goes through `postStockMove`. It:
//   1. locks the item row (serialises concurrent moves on one item),
//   2. reads PHYSICAL / RESERVED / AVAILABLE inside that lock,
//   3. refuses a fractional qty for a whole-number unit (NOS / SET),
//   4. applies the caller's GUARD for an 'out',
//   5. inserts the locked ledger line (the 0020 trigger moves the balance).
//   (+ for a track_serial item, the serial cover — P38, see below.)
//
// Before this, eleven modules each re-implemented steps 1–5 with their own
// `SELECT on_hand::int` — so a decimal quantity, a whole-number rule or an
// Available check had to be changed in eleven places and drifted.
//
// Guards (for txnType 'out'; an 'in' is never refused for stock):
//   'available' — qty ≤ physical − booked-for-SO (store issue, tool issue,
//                 JW DC out, manual adjust −). Default.
//   'on_hand'   — qty ≤ physical (dispatch / JW return consume their OWN
//                 booking, so Available would wrongly count it as taken).
//   'none'      — no check (compensating reversals whose caller already
//                 proved the stock, and legacy assembly — ADR-115).
//
// Drawing Rev Phase C (0233): `itemRevisionId` names the Item + Rev bucket.
// Whatever the guard, an 'out' may not take a bucket below zero; under
// 'available' it may not take more than the bucket's free qty either. An
// 'out' that names no Rev (undefined) takes from any bucket (0234 fix).

import {
  ITEM_TYPE_RULES,
  type ItemType,
  isWholeNumberUom,
  roundQty,
  type StoreTxnSourceType,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { storeTransactions } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import {
  assertRevBelongsToItem,
  bucketLabel,
  readRevBucketPosition,
  readRevBuckets,
  readStockPosition,
  type StockPosition,
} from './stock-reservation';

/** Units that can only move in whole pieces, and the 3-decimal rounding —
 *  one definition for web + API since fix wave 2 (packages/shared
 *  lib/qty-rule.ts, ERPNext UOM "Must be whole number"). Re-exported so the
 *  existing imports keep working. */
export { WHOLE_NUMBER_UOMS, roundQty } from '@innovic/shared';

export type StockGuard = 'available' | 'on_hand' | 'none';

export interface StockMoveInput {
  companyId: string;
  itemId: string;
  txnType: 'in' | 'out';
  qty: number;
  sourceType: StoreTxnSourceType;
  sourceRef: string;
  remarks?: string | null;
  txnDate: string;
  userId: string;
  /** Snapshot of the item code for the ledger line; read from the item when omitted. */
  itemCodeText?: string | null;
  guard?: StockGuard;
  /** ADR-193 3c — with guard 'available' only: extra qty the caller may take on
   *  top of Available (this SO's own assembly reservation). Default 0. */
  allowance?: number;
  /** Wording for the refusal, e.g. "Issue Qty"; default "Qty". */
  qtyLabel?: string;
  /** Drawing Rev Phase C (0233) — the Item + Rev bucket this move lands in /
   *  leaves (store_transactions.item_revision_id; the trigger moves the
   *  bucket).
   *    • a uuid — that bucket only;
   *    • null   — the blank (old / no-Rev) bucket only;
   *    • omitted (undefined — the caller has no Rev: Item Issue, JW DC
   *      Outward, Tool Issue …) — an 'in' lands in the blank bucket; an 'out'
   *      takes from ANY bucket: blank first, then the Rev buckets largest on
   *      hand first (tie: Rev id), free stock before booked stock — one ledger
   *      row per bucket used, all under the one item lock (0234 fix).
   *  A named bucket ('out') is also refused when it would go below zero (and,
   *  under guard 'available', below its free qty): the item total alone cannot
   *  see a wrong-Rev shipment. */
  itemRevisionId?: string | null;
}

export interface StockMoveResult {
  /** The (first) ledger row. An un-named 'out' split over several Rev buckets
   *  writes one row per bucket — all of them are in `rows`. */
  id: string;
  rows: Array<{ id: string; itemRevisionId: string | null; qty: number }>;
  stockBefore: number;
  stockAfter: number;
  /** Position read before the move (inside the lock). */
  position: StockPosition;
  itemCode: string;
  uom: string;
}

/** Lock the item row and return its code / unit. Exposed for callers that must
 *  check several things under the same lock before moving stock. */
export async function lockItemForStock(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<{ code: string; uom: string; trackSerial: boolean; itemType: string | null }> {
  const rows = (await tx.execute(sql`
    SELECT code, uom::text AS uom, track_serial AS "trackSerial", item_type::text AS "itemType"
    FROM public.items
    WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `)) as unknown as Array<{
    code: string;
    uom: string;
    trackSerial: boolean;
    itemType: string | null;
  }>;
  const row = rows[0];
  if (!row) throw new NotFoundError('Item not found. Please select the Item Code again.');
  return {
    code: row.code,
    uom: row.uom,
    trackSerial: Boolean(row.trackSerial),
    itemType: row.itemType ?? null,
  };
}

/** ADR-193 phase 4 (P38) — pieces the instrument register says are on the
 *  shelf (In Store + At Calibration). On Hand may never fall below it. */
export async function countInstrumentsInStore(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM public.instruments
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
      AND deleted_at IS NULL AND status IN ('in_store', 'at_calibration')
  `)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/** Refuse a fractional qty for a whole-number unit. */
export function assertQtyFitsUom(itemCode: string, uom: string, qty: number, label = 'Qty'): void {
  if (!(qty > 0)) throw new ValidationError(`${itemCode}: ${label} must be more than 0.`);
  if (isWholeNumberUom(uom) && !Number.isInteger(qty)) {
    throw new ValidationError(
      `${itemCode}: ${label} (${qty}) must be a whole number — the unit is ${uom}.`,
    );
  }
}

export async function postStockMove(
  tx: DbTransaction,
  input: StockMoveInput,
): Promise<StockMoveResult> {
  const qty = roundQty(input.qty);
  const label = input.qtyLabel ?? 'Qty';
  const item = await lockItemForStock(tx, input.companyId, input.itemId);
  // ADR-203 — the customer's own material (Party Supplied Material) lives in
  // the separate party register (party_stock_ledger), never in company stock.
  if (item.itemType && ITEM_TYPE_RULES[item.itemType as ItemType]?.partyOwned) {
    throw new ValidationError(
      `${item.code} is the customer's material (Party Supplied Material) — it cannot be moved ` +
        `in company stock. Use the customer material screens (Party GRN, Issue to Job Card, ` +
        `Customer Material Return).`,
    );
  }
  assertQtyFitsUom(item.code, item.uom, qty, label);

  const position = await readStockPosition(tx, input.companyId, input.itemId);
  const before = roundQty(position.physicalQty);
  const guard = input.guard ?? 'available';

  if (input.txnType === 'out') {
    const allowance = roundQty(Math.max(0, input.allowance ?? 0));
    if (guard === 'available' && qty > roundQty(position.availableQty + allowance)) {
      throw new ConflictError(
        position.reservedQty > 0
          ? `Item ${item.code}: ${label} (${qty}) cannot be more than Available (${roundQty(position.availableQty)}) — In Stock ${before}, of which ${roundQty(position.reservedQty)} is reserved for orders (sales and assembly).`
          : `Item ${item.code}: ${label} (${qty}) cannot be more than In Stock (${before}).`,
      );
    }
    if (guard === 'on_hand' && qty > before) {
      throw new ConflictError(
        `Item ${item.code}: ${label} (${qty}) cannot be more than In Stock (${before}).`,
      );
    }
  }

  const after = roundQty(input.txnType === 'in' ? before + qty : before - qty);
  // S12 — stock never goes below zero, whatever the guard (a 'none' reversal
  // included): read under the item lock above, so this is the real figure.
  // Migration 0181's item_stock_balances_on_hand_nonneg is the database
  // backstop; this is the sentence the user sees instead of its error.
  if (input.txnType === 'out' && after < 0) {
    throw new ConflictError(
      `Item ${item.code}: ${label} (${qty}) cannot be more than In Stock (${before}) — stock cannot go below zero.`,
    );
  }
  // Drawing Rev Phase C — the bucket guard, read under the same item lock.
  // `parts` = the bucket(s) this move touches and how much each.
  let parts: Array<{ revId: string | null; qty: number }>;
  if (input.txnType === 'out' && input.itemRevisionId === undefined) {
    // 0234 fix — the caller has no Rev: take from any bucket (the item-level
    // guard above is the check, exactly as before buckets existed).
    parts = await splitOutAcrossBuckets(tx, input.companyId, input.itemId, qty);
    const covered = roundQty(parts.reduce((a, p) => a + p.qty, 0));
    if (covered < qty) {
      throw new ConflictError(
        `Item ${item.code}: ${label} (${qty}) cannot be more than In Stock (${covered}) across its Drawing Rev buckets.`,
      );
    }
  } else {
    const revId = input.itemRevisionId ?? null;
    const revText = revId
      ? await assertRevBelongsToItem(tx, input.companyId, input.itemId, revId)
      : null;
    if (input.txnType === 'out') {
      const bucket = await readRevBucketPosition(tx, input.companyId, input.itemId, revId);
      const bOnHand = roundQty(bucket.onHandQty);
      const name = bucketLabel(item.code, revText);
      if (qty > bOnHand) {
        throw new ConflictError(
          `${name}: ${label} (${qty}) cannot be more than In Stock of ${name} (${bOnHand}).` +
            (revId ? '' : ' Stock with a Drawing Rev must be taken from its own Rev.'),
        );
      }
      const allowance = roundQty(Math.max(0, input.allowance ?? 0));
      if (guard === 'available' && qty > roundQty(bucket.freeQty + allowance)) {
        throw new ConflictError(
          `${name}: ${label} (${qty}) cannot be more than Available of ${name} (${roundQty(Math.max(0, bucket.freeQty))}) — In Stock ${bOnHand}, of which ${roundQty(bucket.reservedQty)} is reserved for orders.`,
        );
      }
    }
    parts = [{ revId, qty }];
  }
  // Serial cover (P38): every move of a serial item — adjust, count, issue,
  // dispatch — must leave On Hand ≥ the pieces registered as on the shelf.
  if (item.trackSerial && input.txnType === 'out') {
    const registered = await countInstrumentsInStore(tx, input.companyId, input.itemId);
    if (after < registered) {
      throw new ConflictError(
        `${item.code}: On Hand would be ${after} but ${registered} instruments are registered In Store / At Calibration — use Instrument Register → Mark Missing (then count again) or Scrap first.`,
      );
    }
  }
  // One ledger row per bucket; stock before / after run on the ITEM total.
  const rows: StockMoveResult['rows'] = [];
  let running = before;
  for (const part of parts) {
    const rowAfter = roundQty(input.txnType === 'in' ? running + part.qty : running - part.qty);
    const inserted = await tx
      .insert(storeTransactions)
      .values({
        companyId: input.companyId,
        txnDate: input.txnDate,
        itemId: input.itemId,
        itemCodeText: input.itemCodeText === undefined ? item.code : input.itemCodeText,
        txnType: input.txnType,
        qty: part.qty,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        stockBefore: running,
        stockAfter: rowAfter,
        remarks: input.remarks ?? null,
        itemRevisionId: part.revId,
        createdBy: input.userId,
      })
      .returning({ id: storeTransactions.id });
    rows.push({ id: inserted[0]!.id, itemRevisionId: part.revId, qty: part.qty });
    running = rowAfter;
  }
  return {
    id: rows[0]!.id,
    rows,
    stockBefore: before,
    stockAfter: after,
    position,
    itemCode: item.code,
    uom: item.uom,
  };
}

/** An 'out' that names no Rev (0234 fix): which buckets give how much.
 *  Order: blank bucket first, then the Rev buckets largest on hand first (tie:
 *  Rev id). FREE stock of each bucket in that order first, then what is left
 *  on hand (booked stock — reached only when the item-level guard already let
 *  the move through, e.g. a slip's own assembly reservation, or guard
 *  'on_hand' / 'none'). A bucket is never taken below zero. Caller holds the
 *  item lock, so these figures are the real ones (§20.3). */
async function splitOutAcrossBuckets(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  qty: number,
): Promise<Array<{ revId: string | null; qty: number }>> {
  const buckets = ((await readRevBuckets(tx, companyId, [itemId])).get(itemId) ?? [])
    .map((b) => ({
      revId: b.itemRevisionId,
      onHand: roundQty(Math.max(0, b.onHandQty)),
      free: roundQty(Math.max(0, Math.min(b.freeQty, b.onHandQty))),
    }))
    .filter((b) => b.onHand > 0)
    .sort((a, b) => {
      if (a.revId === null) return b.revId === null ? 0 : -1;
      if (b.revId === null) return 1;
      return b.onHand - a.onHand || a.revId.localeCompare(b.revId);
    });
  const take = new Map<string | null, number>();
  let left = qty;
  for (const pass of ['free', 'onHand'] as const) {
    for (const b of buckets) {
      if (left <= 0) break;
      const already = take.get(b.revId) ?? 0;
      const room = roundQty((pass === 'free' ? b.free : b.onHand) - already);
      if (room <= 0) continue;
      const t = roundQty(Math.min(room, left));
      take.set(b.revId, roundQty(already + t));
      left = roundQty(left - t);
    }
  }
  // Rows in the bucket order above (blank first) — deterministic.
  return buckets
    .filter((b) => (take.get(b.revId) ?? 0) > 0)
    .map((b) => ({ revId: b.revId, qty: take.get(b.revId)! }));
}
