// Reorder Level / Reorder Qty, the Reorder List and one-click PRs
// (ADR-193 phase 5, spec §15 — R1–R12, fixes P18, P19, P44–P48).
//
//   PATCH /store-inventory/items/:id/reorder   setReorder       (item_create edit)
//   GET   /store-inventory/reorder-list        getReorderList   (Store view)
//   POST  /store-inventory/reorder-pr          raiseReorderPrs  (pr_create entry)
//
// "Below Reorder" is decided in reorder-rule.ts and nowhere else.

import type {
  ReorderListRow,
  ReorderPrInput,
  ReorderPrResult,
  SetReorderInput,
} from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { items, vendors } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertQtyFitsUom, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { insertPurchaseRequestTx } from '../purchase-requests/service';
import {
  isReorderableType,
  readBelowReorder,
  readOpenPrsByItem,
  readSuggestedVendors,
  suggestedReorderQty,
} from './reorder-rule';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** P48 — only reorderable item types carry a Reorder Level. */
function notReorderableMessage(code: string): string {
  return `${code} is an Assembly — it is built, not reordered`;
}

/** Today's calendar date in IST (the UTC date is yesterday before 05:30 IST). */
function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function setReorder(
  input: SetReorderInput,
  user: AuthContext,
): Promise<{ ok: true; reorderLevel: number; reorderQty: number }> {
  // Same tier the old Min Qty button had: the level lives on a saved item row.
  await requireFormAccess(user, 'item_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select({
        code: items.code,
        uom: items.uom,
        itemType: items.itemType,
        reorderLevel: items.minStockQty,
        reorderQty: items.reorderQty,
      })
      .from(items)
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1)
      .for('update');
    const cur = found[0];
    if (!cur) throw new NotFoundError('Item not found. Refresh the page.');
    const level = roundQty(input.reorderLevel);
    const qty = roundQty(input.reorderQty);
    // Clearing (0 / 0) is always allowed — it takes a wrongly-set level off.
    if ((level > 0 || qty > 0) && !isReorderableType(cur.itemType)) {
      throw new ValidationError(notReorderableMessage(cur.code));
    }
    const uom = cur.uom;
    if (level > 0) assertQtyFitsUom(cur.code, uom, level, 'Reorder Level');
    if (qty > 0) assertQtyFitsUom(cur.code, uom, qty, 'Reorder Qty');

    await tx
      .update(items)
      .set({ minStockQty: level, reorderQty: qty, updatedAt: new Date(), updatedBy: user.id })
      .where(and(eq(items.id, input.itemId), eq(items.companyId, companyId)));
    await emitActivityLog(
      tx,
      {
        action: 'SET_REORDER',
        entity: 'Store Inventory',
        detail: `${cur.code}: Reorder Level ${cur.reorderLevel} → ${level}, Reorder Qty ${cur.reorderQty} → ${qty}`,
        refId: cur.code,
      },
      companyId,
      user,
    );
    return { ok: true as const, reorderLevel: level, reorderQty: qty };
  });
}

export async function getReorderList(user: AuthContext): Promise<ReorderListRow[]> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const below = await readBelowReorder(tx, companyId);
    const ids = below.map((r) => r.itemId);
    // One after the other — both run on the same transaction connection.
    const openPrs = await readOpenPrsByItem(tx, companyId, ids);
    const vendorsByItem = await readSuggestedVendors(tx, companyId, ids);
    return below.map((r) => ({
      itemId: r.itemId,
      itemCode: r.itemCode,
      itemName: r.itemName,
      uom: r.uom,
      itemType: r.itemType,
      reorderLevel: r.reorderLevel,
      reorderQty: r.reorderQty,
      availableQty: r.availableQty,
      onPoQty: r.onPoQty,
      suggestedQty: suggestedReorderQty(r),
      openPrs: openPrs.get(r.itemId) ?? [],
      suggestedVendor: vendorsByItem.get(r.itemId) ?? null,
    }));
  });
}

export async function raiseReorderPrs(
  input: ReorderPrInput,
  user: AuthContext,
): Promise<ReorderPrResult> {
  // Raising a PR is an entry right — the same gate as the PR form.
  await requireFormAccess(user, 'pr_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // P47 — two people pressing Raise PRs at once queue here; the second one
    // then sees the first one's PRs in the open-PR re-check below.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'reorder-pr:' + companyId}))`);

    const itemIds = input.lines.map((l) => l.itemId);
    const itemRows = await tx
      .select({
        id: items.id,
        code: items.code,
        name: items.name,
        uom: items.uom,
        itemType: items.itemType,
      })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), inArray(items.id, itemIds), isNull(items.deletedAt)),
      );
    const itemById = new Map(itemRows.map((r) => [r.id, r]));
    const vendorIds = Array.from(new Set(input.lines.map((l) => l.vendorId)));
    const vendorRows = await tx
      .select({ id: vendors.id, code: vendors.code, isActive: vendors.isActive })
      .from(vendors)
      .where(
        and(
          eq(vendors.companyId, companyId),
          inArray(vendors.id, vendorIds),
          isNull(vendors.deletedAt),
        ),
      );
    const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

    // Every line is checked before anything is written — one bad line refuses
    // the whole batch, so nothing is half-raised.
    for (const l of input.lines) {
      const it = itemById.get(l.itemId);
      if (!it) throw new NotFoundError('An item on the list was not found. Refresh the page.');
      if (!isReorderableType(it.itemType))
        throw new ValidationError(notReorderableMessage(it.code));
      // P46 — no PO history means no suggested vendor; the row must pick one.
      const vendor = vendorById.get(l.vendorId);
      if (!vendor) {
        throw new ValidationError(`${it.code}: the Vendor was not found — pick the vendor again.`);
      }
      if (!vendor.isActive) {
        throw new ValidationError(`${it.code}: vendor ${vendor.code} is inactive — pick another`);
      }
      assertQtyFitsUom(it.code, it.uom, roundQty(l.qty), 'PR Qty');
    }

    const below = new Map(
      (await readBelowReorder(tx, companyId, itemIds)).map((r) => [r.itemId, r]),
    );
    const openPrs = await readOpenPrsByItem(tx, companyId, itemIds);
    const prDate = todayIst();
    const result: ReorderPrResult = { created: [], skipped: [] };

    for (const l of input.lines) {
      const it = itemById.get(l.itemId)!;
      const open = openPrs.get(l.itemId);
      if (open && open.length > 0) {
        result.skipped.push({
          itemCode: it.code,
          reason: `open PR ${open.map((p) => p.code).join(', ')} already raised`,
        });
        continue;
      }
      const pos = below.get(l.itemId);
      if (!pos) {
        result.skipped.push({ itemCode: it.code, reason: 'no longer below its Reorder Level' });
        continue;
      }
      const qty = roundQty(l.qty);
      // The PR module's own create — numbering, status Open (approval inbox,
      // ADR-189), every check and the activity log, exactly as a hand-raised PR.
      const pr = await insertPurchaseRequestTx(
        tx,
        {
          prDate,
          status: 'open',
          prType: 'standard',
          vendorId: l.vendorId,
          itemId: it.id,
          itemCodeText: it.code,
          ...(it.name ? { itemName: it.name } : {}),
          qty,
          estCost: 0,
          ...(l.requiredDate ? { requiredDate: l.requiredDate } : {}),
          remarks: `Reorder: Reorder Level ${pos.reorderLevel}, Available ${pos.availableQty}, On PO ${pos.onPoQty}`,
        },
        user,
        companyId,
      );
      result.created.push({ itemCode: it.code, prId: pr.id, prCode: pr.code, qty });
    }
    return result;
  });
}
