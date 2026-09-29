// ADR-193 phase 3a — the raw-material ITEM a part is cut from, plus how much
// of it one piece takes (Required = rmQtyPerPiece × JC qty).
//
// One validator for every writer of the pair (Route Card, Plan, Job Card), so
// the three can never disagree on what a legal pair is:
//   - both set or both null — an item without a qty (or a qty without an
//     item) cannot compute Required, so it is refused rather than half-stored;
//   - the item is a live row of THIS company's Item Master;
//   - its Item Type may be issued against a Job Card
//     (ITEM_TYPE_RULES[type].jobMaterial — Raw Material / Component today).
//
// "Not sent" (undefined) and null both mean "not set" — the write inputs carry
// the whole header, the same contract as raw-material grade / size.

import { ITEM_TYPE_RULES, type ItemType } from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { items } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';

export interface ResolvedRmItem {
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
}

export async function resolveRmItem(
  tx: DbTransaction,
  companyId: string,
  input: {
    rawMaterialItemId?: string | null | undefined;
    rmQtyPerPiece?: number | null | undefined;
  },
): Promise<ResolvedRmItem> {
  const itemId = input.rawMaterialItemId ?? null;
  const qty = input.rmQtyPerPiece ?? null;

  if (itemId === null && qty === null) return { rawMaterialItemId: null, rmQtyPerPiece: null };
  if (itemId === null || qty === null) {
    throw new ValidationError(
      'RM Item and RM Qty per piece go together — fill both, or leave both blank',
    );
  }
  if (!(qty > 0)) throw new ValidationError('RM Qty per piece must be greater than 0');

  const rows = await tx
    .select({ code: items.code, itemType: items.itemType })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ValidationError('RM Item not found. Pick the Item Code from Item Master.');
  }
  const rule = ITEM_TYPE_RULES[row.itemType as ItemType];
  if (!rule?.jobMaterial) {
    throw new ValidationError(
      `${row.code} is a ${rule?.label ?? row.itemType} item — a Job Card's raw material must be a Raw Material or Component item`,
    );
  }
  return { rawMaterialItemId: itemId, rmQtyPerPiece: qty };
}
