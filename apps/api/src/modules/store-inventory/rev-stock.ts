// GET /store-inventory/:itemId/revs — stock of ONE item per Item + Drawing Rev
// bucket (Drawing Rev Phase C, migration 0233). Item totals are untouched; this
// is the split behind them: one row per Rev bucket that holds or books stock,
// plus the blank (old / no-Rev) bucket when it is non-zero or the only one.
// Bookings = the open SO-line reservations held in each bucket.
// Read access: the Store Inventory list's own (STORE_VIEW_FORMS).

import type { ItemRevStockRow } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { items } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { roundQty } from '../../lib/stock-ledger';
import { BLANK_REV_KEY, bucketLabel, readRevBuckets, revKeyOf } from '../../lib/stock-reservation';

export async function listItemRevStock(
  itemId: string,
  user: AuthContext,
): Promise<ItemRevStockRow[]> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError('Item not found. Refresh the page.');

    const buckets = (await readRevBuckets(tx, companyId, [itm.id])).get(itm.id) ?? [];
    const revs = (await tx.execute(sql`
      SELECT id, rev FROM public.item_revisions
       WHERE company_id = ${companyId}::uuid AND item_id = ${itm.id}::uuid
    `)) as unknown as Array<{ id: string; rev: string }>;
    const revText = new Map(revs.map((r) => [r.id, r.rev]));
    const bookings = (await tx.execute(sql`
      SELECT COALESCE(item_revision_id, ${BLANK_REV_KEY}::uuid)::text AS rev_key,
             so_line_id, so_code_text, line_no,
             SUM(qty - consumed_qty - released_qty)::float8 AS held
        FROM public.so_stock_reservations
       WHERE company_id = ${companyId}::uuid AND item_id = ${itm.id}::uuid
         AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
       GROUP BY 1, so_line_id, so_code_text, line_no
      HAVING SUM(qty - consumed_qty - released_qty) > 0
       ORDER BY so_code_text, line_no
    `)) as unknown as Array<{
      rev_key: string;
      so_line_id: string;
      so_code_text: string;
      line_no: number | null;
      held: number;
    }>;

    const rows: ItemRevStockRow[] = buckets
      .filter(
        (b) =>
          b.onHandQty !== 0 ||
          b.reservedQty !== 0 ||
          (b.itemRevisionId === null && buckets.length === 1),
      )
      .map((b) => {
        const rev = b.itemRevisionId ? (revText.get(b.itemRevisionId) ?? '?') : null;
        const key = revKeyOf(b.itemRevisionId);
        return {
          itemRevisionId: b.itemRevisionId,
          label: bucketLabel(itm.code, rev),
          drawingRev: rev,
          onHandQty: roundQty(b.onHandQty),
          reservedQty: roundQty(b.reservedQty),
          freeQty: roundQty(b.freeQty),
          bookings: bookings
            .filter((k) => k.rev_key === key)
            .map((k) => ({
              soLineId: k.so_line_id,
              docCode: k.so_code_text,
              lineNo: k.line_no === null ? null : Number(k.line_no),
              qty: roundQty(Number(k.held)),
            })),
        };
      })
      // Rev buckets by Rev, the blank (old stock) bucket last.
      .sort((a, b) =>
        a.itemRevisionId === null
          ? 1
          : b.itemRevisionId === null
            ? -1
            : (a.drawingRev ?? '').localeCompare(b.drawingRev ?? ''),
      );
    if (rows.length === 0) {
      rows.push({
        itemRevisionId: null,
        label: bucketLabel(itm.code, null),
        drawingRev: null,
        onHandQty: 0,
        reservedQty: 0,
        freeQty: 0,
        bookings: [],
      });
    }
    return rows;
  });
}
