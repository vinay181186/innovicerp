// POST /item-revisions/stock-set-rev — Fix List → Set Rev (Drawing Rev Phase C).
//
// Old stock of a MAKE item sits in the blank (no-Rev) bucket. The team moves it
// by hand to the Item + Rev it really is: ONE out of the blank bucket and ONE in
// to the Rev bucket, both through the single stock writer (postStockMove,
// §20.1), source 'rev_change'. The item total is unchanged (out + in of the
// same qty); only the bucket split moves.
//
// §20.3 — the limit (qty ≤ blank-bucket FREE) is checked inside the writing
// transaction under the item row lock (lockItemForStock → bucket read → the
// two postStockMove rows). Two
// concurrent Set Revs on the same stock serialise on that lock; the second sees
// the first one's move and is refused if the blank bucket no longer covers it.
//
// Access: Item Master Edit or Store (Item Issue) Edit — the manual stock adjust's
// right, plus the store team that holds the stock.

import { ActivityAction, type SetStockRevInput } from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { items } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import {
  assertRevBelongsToItem,
  bucketLabel,
  readRevBucketPosition,
} from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';

export interface SetStockRevResult {
  ok: true;
  itemId: string;
  itemRevisionId: string;
  qty: number;
  outTxnId: string;
  inTxnId: string;
}

export async function setStockRev(
  input: SetStockRevInput,
  user: AuthContext,
): Promise<SetStockRevResult> {
  await requireAnyFormAccess(user, [
    ['item_create', 'edit'],
    ['issue_create', 'edit'],
  ]);
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const qty = roundQty(input.qty);

  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code, procurementType: items.procurementType })
      .from(items)
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError('Item not found. Refresh the page.');
    if (itm.procurementType !== 'make') {
      throw new ValidationError(
        `${itm.code} is not a Make item — only Make items carry stock per Drawing Rev.`,
      );
    }
    const rev = await assertRevBelongsToItem(tx, companyId, itm.id, input.itemRevisionId);
    const from = bucketLabel(itm.code, null);
    const to = bucketLabel(itm.code, rev);
    const today = new Date().toISOString().slice(0, 10);
    const note = input.remarks ? ` · ${input.remarks}` : '';

    // §20.3 — lock the item, then read the blank bucket's FREE qty under that
    // lock (bookings held in the blank bucket stay put). Not the item's
    // Available: a Rev booking whose pieces still sit in the blank bucket is
    // exactly what Set Rev exists to cover.
    await lockItemForStock(tx, companyId, itm.id);
    const blank = await readRevBucketPosition(tx, companyId, itm.id, null);
    if (qty > roundQty(blank.freeQty)) {
      throw new ConflictError(
        `${from}: Set Rev Qty (${qty}) cannot be more than Free in ${from} (${roundQty(Math.max(0, blank.freeQty))}) — ` +
          `In Stock ${roundQty(blank.onHandQty)}, of which ${roundQty(blank.reservedQty)} is reserved.`,
      );
    }
    // OUT of the blank bucket (postStockMove re-checks the bucket on hand).
    const out = await postStockMove(tx, {
      companyId,
      itemId: itm.id,
      itemRevisionId: null,
      txnType: 'out',
      qty,
      sourceType: 'rev_change',
      sourceRef: `SET-REV · ${to}`,
      remarks: `Set Rev: ${from} → ${to}${note}`,
      txnDate: today,
      userId: user.id,
      itemCodeText: itm.code,
      guard: 'on_hand',
      qtyLabel: 'Set Rev Qty',
    });
    // IN to the Rev bucket — same lock already held.
    const inn = await postStockMove(tx, {
      companyId,
      itemId: itm.id,
      itemRevisionId: input.itemRevisionId,
      txnType: 'in',
      qty,
      sourceType: 'rev_change',
      sourceRef: `SET-REV · ${to}`,
      remarks: `Set Rev: ${from} → ${to}${note}`,
      txnDate: today,
      userId: user.id,
      itemCodeText: itm.code,
      guard: 'none',
      qtyLabel: 'Set Rev Qty',
    });

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'Store Inventory',
        entityId: itm.id,
        refId: itm.code,
        qty,
        detail: `Set Rev: ${qty} of ${from} → ${to} (item stock unchanged at ${inn.stockAfter})${note}`,
        changes: [{ field: 'drawingRev', label: 'Drawing Rev', before: null, after: rev }],
      },
      companyId,
      user,
    );

    return {
      ok: true as const,
      itemId: itm.id,
      itemRevisionId: input.itemRevisionId,
      qty,
      outTxnId: out.id,
      inTxnId: inn.id,
    };
  });
}
