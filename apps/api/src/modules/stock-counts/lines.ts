// Stock Count line helpers (ADR-193 phase 2): the document number, line
// validation against the Item Master (C3–C5) and the line insert.

import type { StockCountLineInput } from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { items, stockCountLines } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { assertQtyFitsUom, roundQty } from '../../lib/stock-ledger';
import { readStockPositions } from '../../lib/stock-reservation';

const CODE_PREFIX = 'IN-SC-';
const CODE_PAD = 5;

/** Next IN-SC-##### under a per-company advisory lock (MAX+1 alone races). */
export async function nextCode(tx: DbTransaction, companyId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'stock_count_code:' + companyId}))`);
  const rows = (await tx.execute(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, ${'^' + CODE_PREFIX}, ''), '')::int), 0) + 1 AS n
    FROM public.stock_counts
    WHERE company_id = ${companyId}::uuid AND code ~ ${'^' + CODE_PREFIX + '\\d+$'}
  `)) as unknown as Array<{ n: number }>;
  return `${CODE_PREFIX}${String(Number(rows[0]?.n ?? 1)).padStart(CODE_PAD, '0')}`;
}

/** Validate lines against the Item Master: live, same company, qty fits UOM (C3–C5). */
export async function checkLines(
  tx: DbTransaction,
  companyId: string,
  lines: StockCountLineInput[],
): Promise<Map<string, { code: string; uom: string }>> {
  const ids = lines.map((l) => l.itemId);
  const rows = await tx
    .select({ id: items.id, code: items.code, uom: items.uom })
    .from(items)
    .where(and(inArray(items.id, ids), eq(items.companyId, companyId), isNull(items.deletedAt)));
  const byId = new Map(rows.map((r) => [r.id, { code: r.code, uom: String(r.uom) }]));
  const missing = lines.filter((l) => !byId.has(l.itemId)).length;
  if (missing > 0) {
    throw new ValidationError(`${missing} line(s) name an item that is not in the Item Master.`);
  }
  for (const l of lines) {
    const it = byId.get(l.itemId)!;
    if (l.countedQty > 0) assertQtyFitsUom(it.code, it.uom, roundQty(l.countedQty), 'Counted Qty');
  }
  return byId;
}

export async function writeLines(
  tx: DbTransaction,
  companyId: string,
  countId: string,
  lines: StockCountLineInput[],
  byId: Map<string, { code: string; uom: string }>,
  userId: string,
  /** Previous snapshot per item, kept when the counted qty did not change. */
  keep: Map<string, { countedQty: number; systemQtyAtCount: number | null }> = new Map(),
): Promise<void> {
  // ADR-193 review: the system qty is snapshotted when the line is KEYED (the
  // moment of counting), not at Submit — a draft keyed in the morning and
  // submitted in the afternoon must not double-count the issues in between.
  // A line whose counted qty is unchanged keeps its original snapshot.
  const snap = new Map<string, number>();
  const toRead = lines
    .filter((l) => {
      const k = keep.get(l.itemId);
      return !(
        k &&
        k.systemQtyAtCount !== null &&
        roundQty(k.countedQty) === roundQty(l.countedQty)
      );
    })
    .map((l) => l.itemId);
  if (toRead.length > 0) {
    const pos = await readStockPositions(tx, companyId, toRead);
    for (const id of toRead) snap.set(id, roundQty(pos.get(id)?.physicalQty ?? 0));
  }
  await tx.insert(stockCountLines).values(
    lines.map((l, i) => ({
      companyId,
      stockCountId: countId,
      lineNo: i + 1,
      itemId: l.itemId,
      itemCodeText: byId.get(l.itemId)!.code,
      countedQty: roundQty(l.countedQty),
      systemQtyAtCount: snap.has(l.itemId)
        ? snap.get(l.itemId)!
        : (keep.get(l.itemId)?.systemQtyAtCount ?? null),
      reason: l.reason ?? null,
      createdBy: userId,
      updatedBy: userId,
    })),
  );
}
