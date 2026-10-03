// Customer Dispatch service tests — assembly finished-good readiness + stock legs.
//
// The Assembly Tracker BUILDS the finished good: completing a batch debits the
// components and CREDITS the parent item into finished-goods stock (ADR-115
// assembly output). So for an assembly / equipment SO line dispatch:
//
//   1. Readiness is the parent's ON-HAND finished-goods stock (gross of what
//      this line already dispatched), NOT a parts / child-JC rollup.
//   2. Dispatch debits the PARENT finished good (the units in stock), never the
//      components — they were already consumed when the batch was assembled.
//
// This replaced the old "phantom parent" model (weakest-component MIN readiness,
// component-by-component debits), which read 0 for tracker-built equipment SOs
// that have no child JCs and blocked dispatch of physically-assembled units.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasters,
  customerDispatchLines,
  customerDispatches,
  invoiceLines,
  invoices,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  cancelDispatch,
  createDispatch,
  getDispatchableSo,
  updateCustomerDispatch,
} from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TDSPB-';

let admin: AuthContext;
let itemIds: string[] = [];

async function makeItem(code: string, name: string): Promise<string> {
  const r = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}${code}`,
      name,
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemIds.push(r[0]!.id);
  return r[0]!.id;
}

/**
 * Build a BOM (its own PEN parent + one component) and an SO line for
 * `orderQty` that points at that BOM. Readiness reads the parent's stock, so
 * every fixture gets a FRESH parent to keep tests from sharing a stock pool.
 * No child JCs are needed — the Tracker credits the parent directly.
 */
async function makeAssemblyFixture(opts: {
  tag: string;
  orderQty: number;
}): Promise<{ soId: string; soLineId: string; parentId: string }> {
  const parentId = await makeItem(`PEN-${opts.tag}`, `Pen assembly ${opts.tag}`);
  const compId = await makeItem(`C-${opts.tag}`, `Component ${opts.tag}`);

  const bom = await db
    .insert(bomMasters)
    .values({
      companyId: admin.companyId!,
      bomNo: `${TEST_PREFIX}${opts.tag}`,
      bomName: `assembly ${opts.tag}`,
      parentItemId: parentId,
      status: 'active',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  await db.insert(bomMasterLines).values({
    companyId: admin.companyId!,
    bomMasterId: bom[0]!.id,
    lineNo: 1,
    childItemId: compId,
    qtyPerSet: '1.00',
    bomType: 'manufacture',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-${opts.tag}`,
      soDate: '2026-08-01',
      status: 'open',
      type: 'component_manufacturing',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const soLine = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: so[0]!.id,
      lineNo: 1,
      itemId: parentId,
      partName: 'PEN',
      orderQty: opts.orderQty,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom[0]!.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();

  return { soId: so[0]!.id, soLineId: soLine[0]!.id, parentId };
}

/** Credit physical finished-goods stock for the parent (Tracker output stand-in). */
async function creditStock(itemId: string, qty: number): Promise<void> {
  await db.insert(storeTransactions).values({
    companyId: admin.companyId!,
    txnDate: '2026-08-02',
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'assembly',
    sourceRef: `${TEST_PREFIX}seed (output)`,
    stockBefore: 0,
    stockAfter: qty,
    remarks: 'test seed',
    createdBy: admin.id,
  });
}

async function onHand(itemId: string): Promise<number> {
  const rows = await db
    .select({ q: itemStockBalances.onHandQty })
    .from(itemStockBalances)
    .where(eq(itemStockBalances.itemId, itemId));
  return Number(rows[0]?.q ?? 0);
}

async function dispatchedQtyOf(soLineId: string): Promise<number> {
  const rows = await db
    .select({ q: salesOrderLines.dispatchedQty })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.id, soLineId));
  return Number(rows[0]?.q ?? 0);
}

/** One SO with TWO assembly lines, each pointing at its own parent-item BOM, so
 *  each line's readiness reads its own parent's on-hand stock. */
async function makeTwoLineFixture(opts: {
  tag: string;
  qty1: number;
  qty2: number;
}): Promise<{
  soId: string;
  soLine1: string;
  soLine2: string;
  parent1: string;
  parent2: string;
}> {
  const mkBom = async (parentId: string, compId: string, tag: string): Promise<string> => {
    const bom = await db
      .insert(bomMasters)
      .values({
        companyId: admin.companyId!,
        bomNo: `${TEST_PREFIX}${tag}`,
        bomName: `assembly ${tag}`,
        parentItemId: parentId,
        status: 'active',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await db.insert(bomMasterLines).values({
      companyId: admin.companyId!,
      bomMasterId: bom[0]!.id,
      lineNo: 1,
      childItemId: compId,
      qtyPerSet: '1.00',
      bomType: 'manufacture',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    return bom[0]!.id;
  };

  const parent1 = await makeItem(`P1-${opts.tag}`, `Pen1 ${opts.tag}`);
  const parent2 = await makeItem(`P2-${opts.tag}`, `Pen2 ${opts.tag}`);
  const comp1 = await makeItem(`X1-${opts.tag}`, `Comp1 ${opts.tag}`);
  const comp2 = await makeItem(`X2-${opts.tag}`, `Comp2 ${opts.tag}`);
  const bom1 = await mkBom(parent1, comp1, `${opts.tag}-1`);
  const bom2 = await mkBom(parent2, comp2, `${opts.tag}-2`);

  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-${opts.tag}`,
      soDate: '2026-08-01',
      status: 'open',
      type: 'component_manufacturing',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const l1 = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: so[0]!.id,
      lineNo: 1,
      itemId: parent1,
      partName: 'PEN',
      orderQty: opts.qty1,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom1,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const l2 = await db
    .insert(salesOrderLines)
    .values({
      companyId: admin.companyId!,
      salesOrderId: so[0]!.id,
      lineNo: 2,
      itemId: parent2,
      partName: 'PEN',
      orderQty: opts.qty2,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom2,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  return {
    soId: so[0]!.id,
    soLine1: l1[0]!.id,
    soLine2: l2[0]!.id,
    parent1,
    parent2,
  };
}

async function cleanup(): Promise<void> {
  const ids = itemIds.filter(Boolean);
  // Invoices reference SOs with RESTRICT, so clear them before the SO rows.
  const invs = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(like(invoices.code, `${TEST_PREFIX}%`));
  if (invs.length > 0) {
    await db.delete(invoiceLines).where(
      inArray(
        invoiceLines.invoiceId,
        invs.map((i) => i.id),
      ),
    );
    await db.delete(invoices).where(like(invoices.code, `${TEST_PREFIX}%`));
  }
  await db.delete(customerDispatchLines).where(like(customerDispatchLines.itemCodeText, `${TEST_PREFIX}%`));
  await db.delete(customerDispatches).where(like(customerDispatches.soCodeText, `${TEST_PREFIX}%`));
  if (ids.length > 0) {
    await db.delete(storeTransactions).where(inArray(storeTransactions.itemId, ids));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, ids));
  }
  await db.delete(salesOrderLines).where(like(salesOrderLines.partName, 'PEN'));
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  const boms = await db.select({ id: bomMasters.id }).from(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  if (boms.length > 0) {
    await db.delete(bomMasterLines).where(
      inArray(bomMasterLines.bomMasterId, boms.map((b) => b.id)),
    );
  }
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  itemIds = [];
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('customer dispatch — assembly finished-good readiness', () => {
  it('reads Ready from the parent on-hand stock, capped at the order qty', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'STOCK', orderQty: 10 });
    await creditStock(parentId, 7);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    // 7 assembled units in stock, nothing dispatched, order has room for 10.
    expect(line.readyQty).toBe(7);
    expect(line.availableQty).toBe(7);
  });

  it('caps available at the order qty when more is in stock than ordered', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'CAP', orderQty: 3 });
    await creditStock(parentId, 10);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(10);
    expect(line.availableQty).toBe(3);
  });

  it('reports 0 ready while nothing has been assembled into stock', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({ tag: 'ZERO', orderQty: 10 });

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(0);
    expect(line.availableQty).toBe(0);
  });
});

describe('customer dispatch — assembly finished-good stock legs', () => {
  it('debits the parent finished good (not the components), then reverses on cancel', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'LEG', orderQty: 10 });
    await creditStock(parentId, 10);

    const dispatch = await createDispatch(
      { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
      admin,
    );

    const mine = (
      await db.select().from(storeTransactions).where(eq(storeTransactions.sourceType, 'dispatch'))
    ).filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code));
    const outs = mine.filter((r) => r.txnType === 'out');

    // Exactly ONE out row, on the PARENT, at the dispatched qty. No components.
    expect(outs).toHaveLength(1);
    expect(outs[0]!.itemId).toBe(parentId);
    expect(outs[0]!.qty).toBe(4);
    expect(await onHand(parentId)).toBe(6);

    // Cancel puts the 4 back on the parent.
    await cancelDispatch(dispatch.id, 'Test cancel', admin);
    const ins = (
      await db.select().from(storeTransactions).where(eq(storeTransactions.sourceType, 'dispatch'))
    )
      .filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code))
      .filter((r) => r.txnType === 'in');
    expect(ins).toHaveLength(1);
    expect(ins[0]!.itemId).toBe(parentId);
    expect(ins[0]!.qty).toBe(4);
    expect(await onHand(parentId)).toBe(10);
  });

  it('refuses to dispatch more than the parent stock (capped by order) allows', async () => {
    const { soId, soLineId, parentId } = await makeAssemblyFixture({ tag: 'GUARD', orderQty: 10 });
    await creditStock(parentId, 3);

    await expect(
      createDispatch(
        { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
        admin,
      ),
    ).rejects.toThrow(/cannot be more than Dispatchable \(3\)/);
  });
});

describe('customer dispatch — edit (ADR-202 Phase 3): reverse-then-repost', () => {
  it('raising Ln1 and lowering Ln2 adjusts stock out + dispatched_qty by the deltas', async () => {
    const { soId, soLine1, soLine2, parent1, parent2 } = await makeTwoLineFixture({
      tag: 'EDIT',
      qty1: 10,
      qty2: 10,
    });
    await creditStock(parent1, 10);
    await creditStock(parent2, 10);

    const dispatch = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-08-03',
        lines: [
          { salesOrderLineId: soLine1, qty: 4 },
          { salesOrderLineId: soLine2, qty: 6 },
        ],
      },
      admin,
    );
    // Baseline: on-hand debited, dispatched_qty bumped.
    expect(await onHand(parent1)).toBe(6);
    expect(await onHand(parent2)).toBe(4);
    expect(await dispatchedQtyOf(soLine1)).toBe(4);
    expect(await dispatchedQtyOf(soLine2)).toBe(6);

    const line1 = dispatch.lines.find((l) => l.salesOrderLineId === soLine1)!;
    const line2 = dispatch.lines.find((l) => l.salesOrderLineId === soLine2)!;

    // Raise Ln1 4 → 7, lower Ln2 6 → 2.
    const edited = await updateCustomerDispatch(
      dispatch.id,
      {
        lines: [
          { id: line1.id, qty: 7 },
          { id: line2.id, qty: 2 },
        ],
      },
      admin,
    );

    // Stock reposted at the NEW qtys: 10 − 7 = 3, 10 − 2 = 8.
    expect(await onHand(parent1)).toBe(3);
    expect(await onHand(parent2)).toBe(8);
    expect(await dispatchedQtyOf(soLine1)).toBe(7);
    expect(await dispatchedQtyOf(soLine2)).toBe(2);
    // The stored dispatch lines carry the new qtys, and the code revision bumped.
    expect(edited.lines.find((l) => l.salesOrderLineId === soLine1)!.qty).toBe(7);
    expect(edited.lines.find((l) => l.salesOrderLineId === soLine2)!.qty).toBe(2);
    expect(edited.code).toMatch(/\/R2$/);
  });

  it('refuses lowering a line below what has been invoiced', async () => {
    const { soId, soLine1, soLine2, parent1, parent2 } = await makeTwoLineFixture({
      tag: 'INV',
      qty1: 10,
      qty2: 10,
    });
    await creditStock(parent1, 10);
    await creditStock(parent2, 10);

    const dispatch = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-08-03',
        lines: [
          { salesOrderLineId: soLine1, qty: 5 },
          { salesOrderLineId: soLine2, qty: 5 },
        ],
      },
      admin,
    );

    // Invoice 5 pcs against SO line 1.
    const inv = await db
      .insert(invoices)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}INV-1`,
        invoiceDate: '2026-08-04',
        salesOrderId: soId,
        soCodeText: `${TEST_PREFIX}SO-INV`,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    await db.insert(invoiceLines).values({
      companyId: admin.companyId!,
      invoiceId: inv[0]!.id,
      lineNo: 1,
      itemId: parent1,
      itemName: 'PEN',
      qty: 5,
      rate: '100',
      salesOrderLineId: soLine1,
      createdBy: admin.id,
      updatedBy: admin.id,
    });

    const line1 = dispatch.lines.find((l) => l.salesOrderLineId === soLine1)!;
    const line2 = dispatch.lines.find((l) => l.salesOrderLineId === soLine2)!;

    // Lowering Ln1 5 → 3 falls below the 5 invoiced — refused; nothing changes.
    await expect(
      updateCustomerDispatch(
        dispatch.id,
        {
          lines: [
            { id: line1.id, qty: 3 },
            { id: line2.id, qty: 5 },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/below invoiced \(Invoiced 5\)/);
    // Stock + dispatched_qty untouched (the whole edit rolled back).
    expect(await onHand(parent1)).toBe(5);
    expect(await dispatchedQtyOf(soLine1)).toBe(5);
  });

  it('applying only Ln1 (Ln2 kept at its current qty) leaves Ln2 untouched', async () => {
    // Mirrors the registry applyEdit reconstruction when ONLY Ln1 is approved:
    // the full line set is resubmitted with Ln2 at its CURRENT qty, so Ln2's
    // stock + dispatched_qty do not move.
    const { soId, soLine1, soLine2, parent1, parent2 } = await makeTwoLineFixture({
      tag: 'PART',
      qty1: 10,
      qty2: 10,
    });
    await creditStock(parent1, 10);
    await creditStock(parent2, 10);

    const dispatch = await createDispatch(
      {
        salesOrderId: soId,
        dispatchDate: '2026-08-03',
        lines: [
          { salesOrderLineId: soLine1, qty: 4 },
          { salesOrderLineId: soLine2, qty: 6 },
        ],
      },
      admin,
    );
    const line1 = dispatch.lines.find((l) => l.salesOrderLineId === soLine1)!;
    const line2 = dispatch.lines.find((l) => l.salesOrderLineId === soLine2)!;

    await updateCustomerDispatch(
      dispatch.id,
      {
        lines: [
          { id: line1.id, qty: 8 }, // approved change
          { id: line2.id, qty: 6 }, // kept at current (Ln2 not approved)
        ],
      },
      admin,
    );

    expect(await onHand(parent1)).toBe(2); // 10 − 8
    expect(await onHand(parent2)).toBe(4); // 10 − 6, unchanged
    expect(await dispatchedQtyOf(soLine1)).toBe(8);
    expect(await dispatchedQtyOf(soLine2)).toBe(6);
  });
});
