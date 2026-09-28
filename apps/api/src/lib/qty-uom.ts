// Decimal quantities on the purchase chain (0172): PR, PO, GRN and JW DC lines
// take 3 places so KGS / MTR material can be ordered as 12.5. A whole-number
// unit (NOS / SET) still may not be split — this refuses a fraction at entry,
// with the item code and unit named, instead of at the far end when the stock
// ledger (lib/stock-ledger.ts, the same rule) would refuse it.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { items } from '../db/schema';
import type { DbTransaction } from '../db/with-user-context';
import { assertQtyFitsUom } from './stock-ledger';

export async function assertLineQtysFitUom(
  tx: DbTransaction,
  companyId: string,
  lines: ReadonlyArray<{ itemId?: string | null | undefined; qty: number | undefined }>,
  label = 'Qty',
): Promise<void> {
  const fractional = lines.filter(
    (l): l is { itemId: string; qty: number } =>
      Boolean(l.itemId) && typeof l.qty === 'number' && !Number.isInteger(l.qty),
  );
  if (fractional.length === 0) return;
  const rows = await tx
    .select({ id: items.id, code: items.code, uom: items.uom })
    .from(items)
    .where(
      and(
        eq(items.companyId, companyId),
        inArray(items.id, Array.from(new Set(fractional.map((l) => l.itemId)))),
        isNull(items.deletedAt),
      ),
    );
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const l of fractional) {
    const it = byId.get(l.itemId);
    if (it) assertQtyFitsUom(it.code, it.uom ?? 'NOS', l.qty, label);
  }
}
