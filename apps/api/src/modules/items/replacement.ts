// ADR-290 — Item Master "Replacement Item" (items.replacement_item_id): the item
// that replaces this one after a non-interchangeable change. Read as a code
// (replacementItemCode); written only through createItem / updateItemTx, which
// call assertReplacementItem first.

import { and, eq, inArray } from 'drizzle-orm';
import { items } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';

/** Refuse the item itself, an unknown item and an item in Trash. */
export async function assertReplacementItem(
  tx: DbTransaction,
  companyId: string,
  selfId: string | null,
  replacementId: string | null | undefined,
): Promise<void> {
  if (!replacementId) return;
  if (replacementId === selfId) throw new ValidationError('An item cannot be its own Replacement Item');
  const [r] = await tx
    .select({ code: items.code, deletedAt: items.deletedAt })
    .from(items)
    .where(and(eq(items.id, replacementId), eq(items.companyId, companyId)))
    .limit(1);
  if (!r) throw new ValidationError('Replacement Item not found in Item Master');
  if (r.deletedAt) throw new ValidationError(`Replacement Item ${r.code} is in Trash — pick a live item`);
}

/** id → code for the given replacement ids (one read). */
export async function replacementCodes(
  tx: DbTransaction,
  companyId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (want.length === 0) return out;
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(inArray(items.id, want), eq(items.companyId, companyId)));
  for (const r of rows) out.set(r.id, r.code);
  return out;
}

/** Rows read from `items` + their replacementItemCode. */
export async function withReplacementCodes<T extends { replacementItemId: string | null }>(
  tx: DbTransaction,
  companyId: string,
  rows: T[],
): Promise<Array<T & { replacementItemCode: string | null }>> {
  const codes = await replacementCodes(
    tx,
    companyId,
    rows.map((r) => r.replacementItemId),
  );
  return rows.map((r) => ({
    ...r,
    replacementItemCode: r.replacementItemId ? (codes.get(r.replacementItemId) ?? null) : null,
  }));
}
