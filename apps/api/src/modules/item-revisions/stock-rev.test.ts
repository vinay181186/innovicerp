// Drawing Rev Phase C (0233) — stock per Item + Rev bucket.
//   • Set Rev moves blank (old) stock into ABC/1 / ABC/2; item total unchanged;
//   • Set Rev of more than the blank bucket's FREE qty → 409;
//   • two Set Revs racing on the same blank stock → exactly one wins, no bucket < 0;
//   • a dispatch of 12 from ABC/1 (10 there) → 409; 8 ships; the cancel puts the
//     8 back into ABC/1, not the blank bucket;
//   • after every step: SUM(buckets) = the item total.
//   0234 fixes:
//   • an 'out' that names no Rev (Item Issue / JW DC / Tool Issue) takes blank
//     first, then Rev buckets — one ledger row per bucket; null = blank only;
//   • a booking with no Rev named: the line's Rev bucket first, then blank;
//   • a dispatch releases excess bookings only in the bucket it shipped, and
//     its cancel holds them again exactly.
// Runs on TEST only (the harness refuses any other database).

import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  customerDispatchLines,
  customerDispatches,
  itemRevisionDrawings,
  itemRevisions,
  itemRevStockBalances,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  soStockReservations,
  storeTransactions,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { resolveItemRevision } from '../../lib/item-revision';
import { postStockMove } from '../../lib/stock-ledger';
import { createReservation } from '../../lib/stock-reservation';
import {
  cancelDispatchTx,
  createDispatch,
  getDispatchableSo,
} from '../customer-dispatches/service';
import { adjustStock } from '../store-inventory/service';
import { listItemRevStock } from '../store-inventory/rev-stock';
import { setStockRev } from './stock-set-rev';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TRSB-';

let admin: AuthContext;
let companyId: string;
let itemId: string;
let rev1: string;
let rev2: string;
let soId: string;
let soLineId: string;

async function cleanup(): Promise<void> {
  const its = await db
    .select({ id: items.id })
    .from(items)
    .where(like(items.code, `${P}%`));
  const ids = its.map((r) => r.id);
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${P}%`));
  const soIds = sos.map((s) => s.id);
  if (soIds.length > 0) {
    const ds = await db
      .select({ id: customerDispatches.id })
      .from(customerDispatches)
      .where(inArray(customerDispatches.salesOrderId, soIds));
    if (ds.length > 0) {
      const dIds = ds.map((d) => d.id);
      await db.delete(activityLog).where(inArray(activityLog.entityId, dIds));
      await db
        .delete(customerDispatchLines)
        .where(inArray(customerDispatchLines.customerDispatchId, dIds));
      await db.delete(customerDispatches).where(inArray(customerDispatches.id, dIds));
    }
  }
  if (ids.length > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('innovic.ledger_maintenance', 'on', true)`);
      await tx.delete(storeTransactions).where(inArray(storeTransactions.itemId, ids));
    });
    await db.delete(itemRevStockBalances).where(inArray(itemRevStockBalances.itemId, ids));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, ids));
  }
  if (ids.length > 0) {
    // Booking trail rows go with their booking (ON DELETE CASCADE).
    await db.delete(soStockReservations).where(inArray(soStockReservations.itemId, ids));
  }
  if (soIds.length > 0) {
    await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
    await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
  }
  if (ids.length > 0) {
    const revs = await db
      .select({ id: itemRevisions.id })
      .from(itemRevisions)
      .where(inArray(itemRevisions.itemId, ids));
    const revIds = revs.map((r) => r.id);
    if (revIds.length > 0) {
      await db
        .delete(itemRevisionDrawings)
        .where(inArray(itemRevisionDrawings.itemRevisionId, revIds));
      await db.delete(itemRevisions).where(inArray(itemRevisions.id, revIds));
    }
    await db.delete(activityLog).where(inArray(activityLog.entityId, ids));
    await db.delete(items).where(inArray(items.id, ids));
  }
}

/** Bucket on hand by Rev id ('' = blank), and the item total. */
async function stock(): Promise<{ buckets: Map<string, number>; total: number }> {
  const bs = await db
    .select({ rev: itemRevStockBalances.itemRevisionId, q: itemRevStockBalances.onHandQty })
    .from(itemRevStockBalances)
    .where(eq(itemRevStockBalances.itemId, itemId));
  const t = await db
    .select({ q: itemStockBalances.onHandQty })
    .from(itemStockBalances)
    .where(eq(itemStockBalances.itemId, itemId));
  return {
    buckets: new Map(bs.map((b) => [b.rev ?? '', Number(b.q)])),
    total: Number(t[0]?.q ?? 0),
  };
}

async function expectBucketsSumToTotal(): Promise<void> {
  const s = await stock();
  const sum = [...s.buckets.values()].reduce((a, b) => a + b, 0);
  expect(sum).toBe(s.total);
  for (const q of s.buckets.values()) expect(q).toBeGreaterThanOrEqual(0);
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const [it] = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}ABC`,
      name: 'Rev stock test part',
      uom: 'NOS',
      itemType: 'component',
      procurementType: 'make',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId = it!.id;
  const mk = (rev: string) =>
    withUserContext(admin, (tx) =>
      resolveItemRevision(tx, admin, companyId, {
        itemId,
        rev,
        sourceType: 'so_line',
        sourceRef: `${P}test`,
      }),
    );
  rev1 = (await mk('1'))!.id;
  rev2 = (await mk('2'))!.id;
  const [so] = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO-1`,
      soDate: '2026-10-31',
      status: 'open',
      type: 'component_manufacturing',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrders.id });
  soId = so!.id;
  const [line] = await db
    .insert(salesOrderLines)
    .values({
      companyId,
      salesOrderId: soId,
      lineNo: 1,
      itemId,
      itemRevisionId: rev1,
      partName: 'ABC',
      orderQty: 20,
      rate: '100',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrderLines.id });
  soLineId = line!.id;
});

afterAll(cleanup);

describe('Stock per Item + Drawing Rev', () => {
  it('Set Rev: 15 old pieces → 10 ABC/1 + 5 ABC/2, item total unchanged', async () => {
    await adjustStock({ itemId, direction: 'add', qty: 15, remarks: `${P}seed old stock` }, admin);
    expect((await stock()).total).toBe(15);
    await setStockRev({ itemId, itemRevisionId: rev1, qty: 10 }, admin);
    await setStockRev({ itemId, itemRevisionId: rev2, qty: 5, remarks: 'test' }, admin);
    const s = await stock();
    expect(s.total).toBe(15);
    expect(s.buckets.get(rev1)).toBe(10);
    expect(s.buckets.get(rev2)).toBe(5);
    expect(s.buckets.get('') ?? 0).toBe(0);
    await expectBucketsSumToTotal();
    const rows = await listItemRevStock(itemId, admin);
    expect(rows.map((r) => [r.label, r.onHandQty])).toEqual([
      [`${P}ABC/1`, 10],
      [`${P}ABC/2`, 5],
    ]);
  });

  it('Set Rev of more than the blank bucket holds → 409, nothing moves', async () => {
    await expect(setStockRev({ itemId, itemRevisionId: rev1, qty: 1 }, admin)).rejects.toThrow(
      ConflictError,
    );
    const s = await stock();
    expect(s.buckets.get(rev1)).toBe(10);
    await expectBucketsSumToTotal();
  });

  it('a manual adjust of a make item with Rev stock must name the bucket', async () => {
    await expect(
      adjustStock({ itemId, direction: 'add', qty: 6, remarks: `${P}no bucket` }, admin),
    ).rejects.toThrow(/choose which Rev/);
    await adjustStock(
      { itemId, direction: 'add', qty: 6, remarks: `${P}old stock`, itemRevisionId: null },
      admin,
    );
    expect((await stock()).buckets.get('')).toBe(6);
    await expectBucketsSumToTotal();
  });

  it('two Set Revs racing on the same blank stock → exactly one wins, no bucket < 0', async () => {
    const results = await Promise.allSettled([
      setStockRev({ itemId, itemRevisionId: rev2, qty: 4 }, admin),
      setStockRev({ itemId, itemRevisionId: rev2, qty: 4 }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    const s = await stock();
    expect(s.buckets.get('')).toBe(2);
    expect(s.buckets.get(rev2)).toBe(9);
    expect(s.total).toBe(21);
    await expectBucketsSumToTotal();
  });

  it('dispatch: Ready per Rev; 12 from ABC/1 refused; 8 ships; cancel returns them to ABC/1', async () => {
    const view = await getDispatchableSo(soId, admin);
    const ln = view.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(ln.revBuckets.map((b) => [b.label, b.readyQty])).toEqual([
      [`${P}ABC/1`, 10],
      [`${P}ABC/2`, 9],
      [`${P}ABC · no Rev`, 2],
    ]);

    await expect(
      createDispatch(
        {
          salesOrderId: soId,
          dispatchDate: '2026-10-31',
          lines: [{ salesOrderLineId: soLineId, itemRevisionId: rev1, qty: 12 }],
        },
        admin,
      ),
    ).rejects.toThrow(ConflictError);
    // Same line + same Rev twice → refused.
    await expect(
      createDispatch(
        {
          salesOrderId: soId,
          dispatchDate: '2026-10-31',
          lines: [
            { salesOrderLineId: soLineId, itemRevisionId: rev1, qty: 1 },
            { salesOrderLineId: soLineId, itemRevisionId: rev1, qty: 1 },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/listed twice/);

    // One SO line, two Revs in one dispatch: 8 of ABC/1 + 1 of ABC/2.
    const d = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-10-31',
        lines: [
          { salesOrderLineId: soLineId, itemRevisionId: rev1, qty: 8 },
          { salesOrderLineId: soLineId, itemRevisionId: rev2, qty: 1 },
        ],
      },
      admin,
    );
    expect(d.lines.map((l) => [l.drawingRev, l.qty])).toEqual([
      ['1', 8],
      ['2', 1],
    ]);
    let s = await stock();
    expect(s.buckets.get(rev1)).toBe(2);
    expect(s.buckets.get(rev2)).toBe(8);
    expect(s.total).toBe(12);
    await expectBucketsSumToTotal();

    await withUserContext(admin, (tx) => cancelDispatchTx(tx, companyId, d.id, `${P}test`, admin));
    s = await stock();
    expect(s.buckets.get(rev1)).toBe(10);
    expect(s.buckets.get(rev2)).toBe(9);
    expect(s.buckets.get('')).toBe(2);
    expect(s.total).toBe(21);
    await expectBucketsSumToTotal();
    const dl = await db
      .select({ rev: customerDispatchLines.itemRevisionId })
      .from(customerDispatchLines)
      .where(and(eq(customerDispatchLines.customerDispatchId, d.id)));
    expect(dl.map((r) => r.rev).sort()).toEqual([rev1, rev2].sort());
  });

  it('a Buy item ships exactly as before: no Rev buckets, blank bucket = item total', async () => {
    const [buy] = await db
      .insert(items)
      .values({
        companyId,
        code: `${P}BUY`,
        name: 'Rev stock test bought part',
        uom: 'NOS',
        itemType: 'component',
        procurementType: 'buy',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: items.id });
    const [line] = await db
      .insert(salesOrderLines)
      .values({
        companyId,
        salesOrderId: soId,
        lineNo: 2,
        itemId: buy!.id,
        partName: 'BUY',
        orderQty: 5,
        rate: '10',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: salesOrderLines.id });
    await adjustStock(
      { itemId: buy!.id, direction: 'add', qty: 5, remarks: `${P}buy seed` },
      admin,
    );
    const view = await getDispatchableSo(soId, admin);
    const ln = view.lines.find((l) => l.salesOrderLineId === line!.id)!;
    expect(ln.revBuckets).toEqual([]);
    expect(ln.availableQty).toBe(5);
    const d = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-10-31',
        lines: [{ salesOrderLineId: line!.id, qty: 3 }],
      },
      admin,
    );
    expect(d.lines[0]!.itemRevisionId).toBeNull();
    const bs = await db
      .select({ rev: itemRevStockBalances.itemRevisionId, q: itemRevStockBalances.onHandQty })
      .from(itemRevStockBalances)
      .where(eq(itemRevStockBalances.itemId, buy!.id));
    expect(bs.map((b) => [b.rev, Number(b.q)])).toEqual([[null, 2]]);
  });
});

/** Pieces still held for the SO line, by Rev id ('' = blank). */
async function heldByRev(lineId: string): Promise<Map<string, number>> {
  const rs = await db
    .select({
      rev: soStockReservations.itemRevisionId,
      qty: soStockReservations.qty,
      c: soStockReservations.consumedQty,
      r: soStockReservations.releasedQty,
    })
    .from(soStockReservations)
    .where(eq(soStockReservations.soLineId, lineId));
  const m = new Map<string, number>();
  for (const x of rs) {
    const k = x.rev ?? '';
    m.set(k, (m.get(k) ?? 0) + (x.qty - x.c - x.r));
  }
  for (const [k, v] of [...m]) if (v === 0) m.delete(k);
  return m;
}

describe('0234 fixes — un-named outs, split bookings, dispatch release', () => {
  it('an out with no Rev takes blank first, then the largest Rev bucket; null = blank only', async () => {
    let s = await stock();
    expect([s.buckets.get(rev1), s.buckets.get(rev2), s.buckets.get('')]).toEqual([10, 9, 2]);
    const mv = await withUserContext(admin, (tx) =>
      postStockMove(tx, {
        companyId,
        itemId,
        txnType: 'out',
        qty: 5,
        sourceType: 'store_issue',
        sourceRef: `${P}ISS`,
        txnDate: '2026-10-31',
        userId: admin.id,
        guard: 'available',
        qtyLabel: 'Issue Qty',
      }),
    );
    expect(mv.rows.map((r) => [r.itemRevisionId, r.qty])).toEqual([
      [null, 2],
      [rev1, 3],
    ]);
    expect(mv.id).toBe(mv.rows[0]!.id);
    expect([mv.stockBefore, mv.stockAfter]).toEqual([21, 16]);
    s = await stock();
    expect([s.buckets.get(rev1), s.buckets.get(rev2), s.buckets.get('')]).toEqual([7, 9, 0]);
    await expectBucketsSumToTotal();
    // Explicit null = the blank bucket only → refused, nothing moves.
    await expect(
      withUserContext(admin, (tx) =>
        postStockMove(tx, {
          companyId,
          itemId,
          itemRevisionId: null,
          txnType: 'out',
          qty: 1,
          sourceType: 'store_issue',
          sourceRef: `${P}ISS2`,
          txnDate: '2026-10-31',
          userId: admin.id,
        }),
      ),
    ).rejects.toThrow(ConflictError);
    // Put the 5 back where they came from.
    for (const [rev, qty] of [
      [null, 2],
      [rev1, 3],
    ] as Array<[string | null, number]>) {
      await withUserContext(admin, (tx) =>
        postStockMove(tx, {
          companyId,
          itemId,
          itemRevisionId: rev,
          txnType: 'in',
          qty,
          sourceType: 'store_return',
          sourceRef: `${P}ISS return`,
          txnDate: '2026-10-31',
          userId: admin.id,
          guard: 'none',
        }),
      );
    }
    s = await stock();
    expect([s.buckets.get(rev1), s.buckets.get(rev2), s.buckets.get(''), s.total]).toEqual([
      10, 9, 2, 21,
    ]);
    await expectBucketsSumToTotal();
  });

  it("a booking with no Rev named: the line's Rev bucket first, then blank (one row each)", async () => {
    await withUserContext(admin, (tx) =>
      createReservation(
        tx,
        {
          companyId,
          soLineId,
          soCodeText: `${P}SO-1`,
          lineNo: 1,
          itemId,
          itemCodeText: `${P}ABC`,
          qty: 12,
          source: 'manual',
        },
        admin,
      ),
    );
    const h = await heldByRev(soLineId);
    expect([h.get(rev1), h.get(''), h.get(rev2)]).toEqual([10, 2, undefined]);
  });

  it('dispatch releases excess only in the shipped bucket; cancel restores the bookings exactly', async () => {
    // 9 of ABC/2 (no bookings there): owed 11, held 12 — the ABC/1 + blank
    // bookings are NOT released (before 0234 one ABC/1 piece was, for good).
    const d1 = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-10-31',
        lines: [{ salesOrderLineId: soLineId, itemRevisionId: rev2, qty: 9 }],
      },
      admin,
    );
    let h = await heldByRev(soLineId);
    expect([h.get(rev1), h.get('')]).toEqual([10, 2]);
    // 1 of ABC/1: consumes 1 ABC/1 booking; owed 10, held 11 → 1 released in ABC/1.
    const d2 = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-10-31',
        lines: [{ salesOrderLineId: soLineId, itemRevisionId: rev1, qty: 1 }],
      },
      admin,
    );
    h = await heldByRev(soLineId);
    expect([h.get(rev1), h.get('')]).toEqual([8, 2]);
    await expectBucketsSumToTotal();

    await withUserContext(admin, (tx) => cancelDispatchTx(tx, companyId, d2.id, `${P}test`, admin));
    h = await heldByRev(soLineId);
    expect([h.get(rev1), h.get('')]).toEqual([10, 2]);
    await withUserContext(admin, (tx) => cancelDispatchTx(tx, companyId, d1.id, `${P}test`, admin));
    h = await heldByRev(soLineId);
    expect([h.get(rev1), h.get('')]).toEqual([10, 2]);
    const s = await stock();
    expect([s.buckets.get(rev1), s.buckets.get(rev2), s.buckets.get(''), s.total]).toEqual([
      10, 9, 2, 21,
    ]);
    await expectBucketsSumToTotal();
    const line = (
      await db
        .select({ d: salesOrderLines.dispatchedQty })
        .from(salesOrderLines)
        .where(eq(salesOrderLines.id, soLineId))
    )[0]!;
    expect(Number(line.d)).toBe(0);
  });
});
