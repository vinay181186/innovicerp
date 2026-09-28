// Item Issue against an assembly SO — ADR-193 phase 3c (spec §13 "Rules").
//
//   issue    a line may take Available + this SO's OWN assembly reservation
//            (the single stock writer's `allowance`); over that → 409 naming
//            the SOs that hold the rest (M12). After posting, the own
//            reservation is used first (oldest first) and the amount is kept
//            on the line (reserved_used_qty) so a Reverse can give it back.
//   return   capped by the SO's Still Out for the item — fitted parts are in
//            built units and cannot come back (P34). No re-reserve.
//   reverse  every line ≤ the SO's Still Out for its item; then each line's
//            reserved_used_qty goes back to the reservation.
//
// Return / Reverse lock the SO row first (same lock assembly Complete takes)
// so a unit cannot be fitted between the Still Out check and the move.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import {
  consumeOwnReservation,
  giveBackReservation,
  lockSoRow,
  NO_PARTS_OUT,
  readOwnAssemblyReserved,
  readPartsOut,
} from '../../lib/assembly-parts';
import { ConflictError } from '../../lib/errors';
import { readBookedForOthers } from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';
import { readStockPositions } from '../../lib/stock-reservation';

/**
 * Before posting an assembly-SO slip (items already locked): every line must
 * fit in Available + the SO's own reservation. Returns the own reservation per
 * item, to pass to postStockMove as `allowance`.
 */
export async function checkAssemblyAllowance(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  lines: ReadonlyArray<{ itemId: string; qty: number }>,
  itemCodes: Map<string, string>,
): Promise<Map<string, number>> {
  const own = await readOwnAssemblyReserved(tx, companyId, soId);
  const itemIds = lines.map((l) => l.itemId);
  const pos = await readStockPositions(tx, companyId, itemIds);
  for (const l of lines) {
    const mine = own.get(l.itemId) ?? 0;
    // Unclamped (review F6): stock below what is reserved must still fail HERE,
    // with the holders named, not later in the stock writer's generic message.
    const avail = roundQty(pos.get(l.itemId)?.availableQty ?? 0);
    if (roundQty(l.qty) <= roundQty(avail + mine)) continue;
    const code = itemCodes.get(l.itemId) ?? '';
    const holders =
      (await readBookedForOthers(tx, companyId, [l.itemId], soId)).get(l.itemId) ?? [];
    const physical = roundQty(pos.get(l.itemId)?.physicalQty ?? 0);
    throw new ConflictError(
      `${code}: only ${avail} free + ${mine} reserved for this SO` +
        (holders.length > 0
          ? `; the rest is reserved for ${holders.map((h) => `${h.soCode} (${h.qty})`).join(', ')}`
          : ` (In Stock ${physical})`),
      { holders },
    );
  }
  return own;
}

/** After a line's 'out' posted: use the SO's own reservation first and record it. */
export async function useOwnReservation(
  tx: DbTransaction,
  args: { companyId: string; soId: string; itemId: string; qty: number; userId: string },
  lineId: string,
): Promise<number> {
  const used = await consumeOwnReservation(
    tx,
    { companyId: args.companyId, soId: args.soId, itemId: args.itemId, userId: args.userId },
    args.qty,
  );
  if (used > 0) {
    await tx.execute(sql`
      UPDATE public.store_issue_lines SET reserved_used_qty = ${used}
      WHERE id = ${lineId}::uuid
    `);
  }
  return used;
}

/** P34 — a Return on an assembly-SO slip may not exceed the SO's Still Out. */
export async function assertReturnWithinStillOut(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  want: ReadonlyArray<{ itemId: string; itemCode: string; qty: number }>,
): Promise<void> {
  await lockSoRow(tx, companyId, soId);
  const out = await readPartsOut(tx, companyId, soId);
  const perItem = new Map<string, { code: string; qty: number }>();
  for (const w of want) {
    const cur = perItem.get(w.itemId);
    perItem.set(w.itemId, { code: w.itemCode, qty: roundQty((cur?.qty ?? 0) + w.qty) });
  }
  for (const [itemId, w] of perItem) {
    const p = out.get(itemId) ?? NO_PARTS_OUT;
    if (w.qty > p.stillOut) {
      throw new ConflictError(
        `${w.code}: ${p.fitted} already fitted into assembled units — only ${Math.max(0, p.stillOut)} can come back`,
        { itemCode: w.code, qty: w.qty, fittedQty: p.fitted, stillOutQty: p.stillOut },
      );
    }
  }
}

/** Reverse on an assembly-SO slip: every line must still be out (not fitted). */
export async function assertReverseWithinStillOut(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  issueCode: string,
  lines: ReadonlyArray<{ itemId: string; qty: number }>,
): Promise<void> {
  await lockSoRow(tx, companyId, soId);
  const out = await readPartsOut(tx, companyId, soId);
  for (const l of lines) {
    const p = out.get(l.itemId) ?? NO_PARTS_OUT;
    if (roundQty(l.qty) > p.stillOut) {
      throw new ConflictError(
        `${issueCode}: its parts are already fitted — Undo the unit first or Return what is still out`,
      );
    }
  }
}

/** Reverse: each line's reserved_used_qty goes back to the SO's reservation. */
export async function giveBackLineReservations(
  tx: DbTransaction,
  args: { companyId: string; soId: string; userId: string },
  lines: ReadonlyArray<{ itemId: string; reservedUsedQty: number }>,
): Promise<void> {
  for (const l of lines) {
    if (!(l.reservedUsedQty > 0)) continue;
    await giveBackReservation(
      tx,
      { companyId: args.companyId, soId: args.soId, itemId: l.itemId, userId: args.userId },
      l.reservedUsedQty,
    );
  }
}
