// The ONE writer of party_stock_ledger rows (ADR-194, migration 0157).
//
// The party store is the SEPARATE, ZERO-VALUE store for customer-supplied
// ("party") material. It never touches store_transactions and it carries no
// rupee value (Q6). Every party-material movement — receive, issue, consume,
// return, reversal — goes through `postPartyStockMove`. It:
//   1. locks the party_materials row (serialises concurrent moves on one code),
//   2. reads the current balance INSIDE that lock — the party-store balance IS
//      party_materials.stock_qty,
//   3. refuses an 'out' that would drive the balance below zero,
//   4. inserts one append-only party_stock_ledger row carrying balanceAfter,
//   5. writes balanceAfter back to party_materials.stock_qty.
//
// This is DELIBERATELY simpler than lib/stock-ledger.postStockMove: no value,
// no reservation/Available maths, no store_transactions, no whole-number-UOM
// rule (party material is booked in whole pieces already). The lifetime
// counters that live beside the balance — received_qty, issued_qty,
// returned_qty — stay the CALLER'S to bump (each caller knows which one its
// movement feeds); this writer owns only stock_qty, the running balance.

import type { PartyStockDirection, PartyStockMovement } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { partyMaterials, partyStockLedger } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export interface PartyStockMoveInput {
  companyId: string;
  partyMaterialId: string;
  /** The JWSO line this movement belongs to, when known — feeds the JC
   *  customer-material roll-up (R1). Null for movements not tied to a line. */
  jwLineId?: string | null;
  movement: PartyStockMovement;
  direction: PartyStockDirection;
  /** Always a positive whole number (the ledger CHECK enforces qty > 0). */
  qty: number;
  sourceDocType: string;
  sourceDocId?: string | null;
  remarks?: string | null;
  userId: string;
  /** Wording for the refusal, e.g. "Issue Qty"; default "Qty". */
  qtyLabel?: string;
}

export interface PartyStockMoveResult {
  id: string;
  balanceBefore: number;
  balanceAfter: number;
  partyMaterialCode: string;
}

/** Lock the LIVE party material row and return its code + current balance
 *  (stockQty). ADR-203: a deleted material can take no movement. */
async function lockPartyMaterial(
  tx: DbTransaction,
  companyId: string,
  partyMaterialId: string,
): Promise<{ code: string; balance: number }> {
  const rows = (await tx.execute(sql`
    SELECT code, stock_qty::int AS balance
    FROM public.party_materials
    WHERE id = ${partyMaterialId}::uuid AND company_id = ${companyId}::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `)) as unknown as Array<{ code: string; balance: number }>;
  const row = rows[0];
  if (!row) {
    throw new NotFoundError('Selected Party Material was not found. Please select it again.');
  }
  return { code: row.code, balance: Number(row.balance) };
}

export async function postPartyStockMove(
  tx: DbTransaction,
  input: PartyStockMoveInput,
): Promise<PartyStockMoveResult> {
  const qty = input.qty;
  const label = input.qtyLabel ?? 'Qty';
  // ADR-203 (D1): whole pieces only — refuse a fraction rather than cut it.
  if (!Number.isInteger(qty) || !(qty > 0)) {
    throw new ValidationError(`${label} must be a whole number greater than 0.`);
  }

  const { code, balance } = await lockPartyMaterial(tx, input.companyId, input.partyMaterialId);

  if (input.direction === 'out' && qty > balance) {
    throw new ConflictError(
      `${code}: ${label} (${qty}) cannot be more than the party-store balance (${balance}).`,
    );
  }

  const balanceAfter = input.direction === 'in' ? balance + qty : balance - qty;

  const inserted = await tx
    .insert(partyStockLedger)
    .values({
      companyId: input.companyId,
      partyMaterialId: input.partyMaterialId,
      jwLineId: input.jwLineId ?? null,
      movement: input.movement,
      direction: input.direction,
      qty,
      balanceAfter,
      sourceDocType: input.sourceDocType,
      sourceDocId: input.sourceDocId ?? null,
      remarks: input.remarks ?? null,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .returning({ id: partyStockLedger.id });

  await tx
    .update(partyMaterials)
    .set({ stockQty: balanceAfter, updatedAt: new Date(), updatedBy: input.userId })
    .where(eq(partyMaterials.id, input.partyMaterialId));

  return {
    id: inserted[0]!.id,
    balanceBefore: balance,
    balanceAfter,
    partyMaterialCode: code,
  };
}
