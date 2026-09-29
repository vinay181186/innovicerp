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

import type { StoreTxnSourceType } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { storeTransactions } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { readStockPosition, type StockPosition } from './stock-reservation';

/** Units that can only move in whole pieces. */
export const WHOLE_NUMBER_UOMS: readonly string[] = ['NOS', 'SET'];

/** Round to the ledger's 3 decimal places (avoids 0.1 + 0.2 drift). */
export function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

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
}

export interface StockMoveResult {
  id: string;
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
): Promise<{ code: string; uom: string; trackSerial: boolean }> {
  const rows = (await tx.execute(sql`
    SELECT code, uom::text AS uom, track_serial AS "trackSerial"
    FROM public.items
    WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `)) as unknown as Array<{ code: string; uom: string; trackSerial: boolean }>;
  const row = rows[0];
  if (!row) throw new NotFoundError('Item not found. Please select the Item Code again.');
  return { code: row.code, uom: row.uom, trackSerial: Boolean(row.trackSerial) };
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
  if (WHOLE_NUMBER_UOMS.includes(uom) && !Number.isInteger(qty)) {
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
  const inserted = await tx
    .insert(storeTransactions)
    .values({
      companyId: input.companyId,
      txnDate: input.txnDate,
      itemId: input.itemId,
      itemCodeText: input.itemCodeText === undefined ? item.code : input.itemCodeText,
      txnType: input.txnType,
      qty,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      stockBefore: before,
      stockAfter: after,
      remarks: input.remarks ?? null,
      createdBy: input.userId,
    })
    .returning({ id: storeTransactions.id });
  return {
    id: inserted[0]!.id,
    stockBefore: before,
    stockAfter: after,
    position,
    itemCode: item.code,
    uom: item.uom,
  };
}
