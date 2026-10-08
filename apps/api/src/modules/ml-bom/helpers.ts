// Multi-Level BOM (ADR-225) — small shared helpers: company check, timestamp
// formatting, item lookups and the line validation every write runs.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { qtyUomProblem } from '@innovic/shared';
import { items } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { timestampMs } from '../../lib/edit-conflict';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import type { MlBomLineInput } from './schema';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** ISO timestamp from a Date or Postgres' text form ("2026-10-08 10:15:02.123456+00"
 *  — what a raw tx.execute returns). Milliseconds, as edit-conflict compares. */
export function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  const ms = timestampMs(String(v));
  return Number.isNaN(ms) ? String(v) : new Date(ms).toISOString();
}

export function maybeTsLike(v: unknown): string | null {
  if (v == null) return null;
  return tsLike(v);
}

export interface ItemInfo {
  code: string;
  name: string;
  uom: string;
}
export type ItemsLookup = Map<string, ItemInfo>;

/** Live items of this company, keyed by id — one query for the whole BOM. */
export async function loadItemsByIds(
  tx: DbTransaction,
  ids: readonly string[],
  companyId: string,
): Promise<ItemsLookup> {
  const out: ItemsLookup = new Map();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: items.id, code: items.code, name: items.name, uom: items.uom })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  for (const r of rows) out.set(r.id, { code: r.code, name: r.name, uom: r.uom });
  return out;
}

/**
 * Every check on the BOM item + its lines that needs the database but not the
 * tree: the items exist live in this company, the BOM item is not one of its
 * own lines, no child twice, and a whole-number unit gets a whole Qty per Set
 * (the same qtyUomProblem rule BOM Master applies).
 */
export async function validateItemAndLines(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  lines: readonly MlBomLineInput[],
): Promise<ItemsLookup> {
  const lookup = await loadItemsByIds(tx, [itemId, ...lines.map((l) => l.childItemId)], companyId);
  const item = lookup.get(itemId);
  if (!item)
    throw new ValidationError('The BOM item was not found. Pick it again from Item Master.');

  const seen = new Map<string, number>();
  lines.forEach((l, i) => {
    const child = lookup.get(l.childItemId);
    if (!child) {
      throw new ValidationError(
        `Line ${i + 1}: the item was not found in Item Master (it may have been deleted). Pick it again.`,
      );
    }
    if (l.childItemId === itemId) {
      throw new ValidationError(
        `${item.code} is the BOM item, so it cannot also be line ${i + 1} of its own BOM.`,
      );
    }
    const first = seen.get(l.childItemId);
    if (first !== undefined) {
      throw new ValidationError(
        `Line ${i + 1}: ${child.code} is already on line ${first + 1}. A BOM lists a part only once.`,
      );
    }
    seen.set(l.childItemId, i);
    const problem = qtyUomProblem(l.qtyPerSet, child.uom, 'Qty per Set');
    if (problem) throw new ValidationError(`Line ${i + 1} (${child.code}): ${problem}`);
  });
  return lookup;
}
