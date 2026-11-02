// 0237 — one return-to-vendor DC for several NCs of one SO (createNcDcBatch).
// Integration tests against the TEST database, same style as service.test.ts.
// NCs are raised through createNcRegister and then set to "disposed, Return to
// Vendor" directly, so each case controls exactly the SO / PO line it needs.

import { and, asc, eq, inArray, isNotNull, isNull, like, notLike, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  deliveryChallanLines,
  deliveryChallans,
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  items,
  jobCards,
  ncRegister,
  purchaseOrderLines,
  purchaseOrders,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { recalcPoHeaderStatus, recalcPoLineReceivedQty } from '../goods-receipt-notes/cascades';
import { createNcDcBatch } from './create-nc-dc';
import * as service from './service';

const TEST_PREFIX = 'T0237-NC-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const DC_INPUT = { dcDate: '2026-11-01', vendorCodeText: 'T0237 vendor' };

let admin: AuthContext;
let itemId: string;
let jobCardId: string;
let soA: string;
let soB: string;
let seq = 0;
/** PO lines the tests moved — recomputed in afterAll once the test rows are gone. */
const touchedPoLines = new Set<string>();

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const it0 = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
      )
      .orderBy(asc(items.createdAt))
      .limit(1)
  )[0];
  const jc0 = (
    await db
      .select({ id: jobCards.id })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.companyId, u.companyId),
          isNull(jobCards.deletedAt),
          notLike(jobCards.code, 'T%-%'),
        ),
      )
      .orderBy(asc(jobCards.createdAt))
      .limit(1)
  )[0];
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, u.companyId), isNull(salesOrders.deletedAt)))
    .orderBy(asc(salesOrders.createdAt))
    .limit(2);
  if (!it0 || !jc0 || sos.length < 2)
    throw new Error('Need an item, a job card and two SOs on TEST');
  itemId = it0.id;
  jobCardId = jc0.id;
  soA = sos[0]!.id;
  soB = sos[1]!.id;
});

afterAll(async () => {
  const ncs = await db
    .select({ id: ncRegister.id })
    .from(ncRegister)
    .where(like(ncRegister.code, `${TEST_PREFIX}%`));
  const ncIds = ncs.map((n) => n.id);
  if (ncIds.length > 0) {
    const dcs = await db
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(inArray(deliveryChallans.ncId, ncIds));
    const dcIds = dcs.map((d) => d.id);
    if (dcIds.length > 0) {
      await db.delete(activityLog).where(inArray(activityLog.entityId, dcIds));
      await db
        .update(ncRegister)
        .set({ deliveryChallanId: null })
        .where(inArray(ncRegister.id, ncIds));
      await db
        .delete(deliveryChallanLines)
        .where(inArray(deliveryChallanLines.deliveryChallanId, dcIds));
      await db.delete(deliveryChallans).where(inArray(deliveryChallans.id, dcIds));
    }
    await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
    await db.delete(ncRegister).where(inArray(ncRegister.id, ncIds));
  }
  // Put the borrowed PO lines / headers back exactly as their own data says.
  for (const lineId of touchedPoLines) {
    await db.transaction(async (tx) => {
      await recalcPoLineReceivedQty(tx, lineId, admin.id);
      const l = (
        await tx
          .select({ poId: purchaseOrderLines.purchaseOrderId })
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.id, lineId))
      )[0];
      if (l) await recalcPoHeaderStatus(tx, l.poId, admin.id);
    });
  }
});

/** A disposed Return-to-Vendor NC on `soId`; optionally a bought-material NC
 *  on `grnLineId` (no job card), which gives it that GRN line's PO line. */
async function rtvNc(
  soId: string | null,
  grnLineId?: string,
): Promise<{ id: string; code: string }> {
  seq += 1;
  const code = `${TEST_PREFIX}${Date.now()}-${seq}`;
  const nc = await service.createNcRegister(
    {
      code,
      ncDate: '2026-11-01',
      jobCardId,
      itemId,
      rejectedQty: 2,
      reasonCategory: 'dimensional',
      reason: 'T0237 multi-NC DC',
    },
    admin,
  );
  await db
    .update(ncRegister)
    .set({
      disposition: 'return_to_vendor',
      status: 'disposed',
      soId,
      ...(grnLineId ? { jobCardId: null, grnLineId } : {}),
    })
    .where(eq(ncRegister.id, nc.id));
  return { id: nc.id, code };
}

/** Two GRN lines of ONE vendor on two DIFFERENT live PO lines, or null. */
async function twoGrnLinesOneVendor(): Promise<[string, string] | null> {
  const rows = await db
    .select({
      lineId: goodsReceiptNoteLines.id,
      poLineId: goodsReceiptNoteLines.purchaseOrderLineId,
      vendorId: goodsReceiptNotes.vendorId,
    })
    .from(goodsReceiptNoteLines)
    .innerJoin(
      goodsReceiptNotes,
      eq(goodsReceiptNotes.id, goodsReceiptNoteLines.goodsReceiptNoteId),
    )
    .innerJoin(
      purchaseOrderLines,
      eq(purchaseOrderLines.id, goodsReceiptNoteLines.purchaseOrderLineId),
    )
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .where(
      and(
        eq(goodsReceiptNotes.companyId, admin.companyId!),
        isNull(goodsReceiptNotes.deletedAt),
        isNull(goodsReceiptNotes.ncId),
        isNull(goodsReceiptNoteLines.deletedAt),
        isNotNull(goodsReceiptNotes.vendorId),
        isNull(purchaseOrders.deletedAt),
        sql`${purchaseOrders.status} <> 'cancelled'`,
      ),
    )
    .limit(500);
  for (const a of rows) {
    const b = rows.find((r) => r.vendorId === a.vendorId && r.poLineId !== a.poLineId);
    if (b) {
      touchedPoLines.add(a.poLineId!);
      touchedPoLines.add(b.poLineId!);
      return [a.lineId, b.lineId];
    }
  }
  return null;
}

describe('createNcDcBatch (0237)', () => {
  it('two NCs of one SO on different PO lines → one DC, two lines, both sent to vendor', async () => {
    const pair = await twoGrnLinesOneVendor();
    // TEST data dependent: without two receipts from one vendor there is no
    // pair of PO lines to send against — nothing to assert.
    if (!pair) return;
    const a = await rtvNc(soA, pair[0]);
    const b = await rtvNc(soA, pair[1]);
    const res = await createNcDcBatch({ ...DC_INPUT, ncIds: [a.id, b.id] }, admin);

    expect(res.ncs.map((n) => n.status)).toEqual(['sent_to_vendor', 'sent_to_vendor']);
    expect(res.ncs.every((n) => n.deliveryChallanId === res.deliveryChallanId)).toBe(true);
    const lines = await db
      .select()
      .from(deliveryChallanLines)
      .where(eq(deliveryChallanLines.deliveryChallanId, res.deliveryChallanId))
      .orderBy(asc(deliveryChallanLines.lineNo));
    expect(lines.map((l) => l.ncId)).toEqual([a.id, b.id]);
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(new Set(lines.map((l) => l.purchaseOrderLineId)).size).toBe(2);
    expect(lines.map((l) => l.dcRemarks)).toEqual([a.code, b.code]);
    const dc = (
      await db.select().from(deliveryChallans).where(eq(deliveryChallans.id, res.deliveryChallanId))
    )[0]!;
    expect(dc.ncId).toBe(a.id); // header = FIRST NC
    expect(dc.status).toBe('issued');
  });

  it('NCs of two different SOs → 409, nothing written', async () => {
    const a = await rtvNc(soA);
    const b = await rtvNc(soB);
    await expect(createNcDcBatch({ ...DC_INPUT, ncIds: [a.id, b.id] }, admin)).rejects.toThrow(
      ConflictError,
    );
    await expect(createNcDcBatch({ ...DC_INPUT, ncIds: [a.id, b.id] }, admin)).rejects.toThrow(
      /one DC can only carry NCs of one Sales Order/,
    );
    const after = await db
      .select({ status: ncRegister.status, dc: ncRegister.deliveryChallanId })
      .from(ncRegister)
      .where(inArray(ncRegister.id, [a.id, b.id]));
    expect(after.every((r) => r.status === 'disposed' && r.dc === null)).toBe(true);
  });

  it('an NC already on a live DC → 409 and nothing written for the others', async () => {
    const a = await rtvNc(soA);
    const b = await rtvNc(soA);
    const first = await createNcDcBatch({ ...DC_INPUT, ncIds: [a.id] }, admin);
    const c = await rtvNc(soA);
    await expect(
      createNcDcBatch({ ...DC_INPUT, ncIds: [c.id, a.id, b.id] }, admin),
    ).rejects.toThrow(ConflictError);
    const rows = await db
      .select({ id: ncRegister.id, status: ncRegister.status, dc: ncRegister.deliveryChallanId })
      .from(ncRegister)
      .where(inArray(ncRegister.id, [a.id, b.id, c.id]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(a.id)!.dc).toBe(first.deliveryChallanId);
    expect(byId.get(b.id)!.dc).toBeNull();
    expect(byId.get(c.id)!.dc).toBeNull();
    expect(byId.get(c.id)!.status).toBe('disposed');
    const lineCount = await db
      .select({ id: deliveryChallanLines.id })
      .from(deliveryChallanLines)
      .where(inArray(deliveryChallanLines.ncId, [b.id, c.id]));
    expect(lineCount).toHaveLength(0);
  });

  it('two saves at once sharing one NC → exactly one wins', async () => {
    const a = await rtvNc(soA);
    const shared = await rtvNc(soA);
    const c = await rtvNc(soA);
    const results = await Promise.allSettled([
      createNcDcBatch({ ...DC_INPUT, ncIds: [a.id, shared.id] }, admin),
      createNcDcBatch({ ...DC_INPUT, ncIds: [shared.id, c.id] }, admin),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    const holding = await db
      .select({ dcId: deliveryChallanLines.deliveryChallanId })
      .from(deliveryChallanLines)
      .innerJoin(deliveryChallans, eq(deliveryChallans.id, deliveryChallanLines.deliveryChallanId))
      .where(and(eq(deliveryChallanLines.ncId, shared.id), isNull(deliveryChallans.deletedAt)));
    expect(holding).toHaveLength(1);
  });
});
