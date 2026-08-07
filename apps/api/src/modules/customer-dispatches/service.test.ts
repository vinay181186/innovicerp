// Customer Dispatch service tests — BOM (assembly) readiness + stock legs.
//
// A BOM parent item is a phantom: it is sold but never produced, so nothing
// ever credits its stock. The BOM-8 cascade spawns one child JC per component,
// ALL carrying source_so_line_id = the parent SO line. Two things follow, and
// both are asserted here:
//
//   1. Readiness is MIN over components of FLOOR(componentReady / qtyPerSet),
//      not SUM. 5 of C1 + 4 of C2 is 4 assemblies, never 9.
//   2. Dispatch debits the COMPONENTS (qty x qtyPerSet), never the parent.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasters,
  customerDispatchLines,
  customerDispatches,
  itemStockBalances,
  items,
  jcOps,
  jobCards,
  opLog,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { withUserContext } from '../../db/with-user-context';
import { cascadeBomToSoLine } from '../bom-master/cascade';
import * as bomService from '../bom-master/service';
import { cancelDispatch, createDispatch, getDispatchableSo } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TDSPB-';

let admin: AuthContext;
let penId: string;
let c1Id: string;
let c2Id: string;
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
  return r[0]!.id;
}

/** Build a BOM (parent PEN) + an SO line for `orderQty`, then run the cascade. */
async function makeAssemblyFixture(opts: {
  tag: string;
  orderQty: number;
  components: Array<{ itemId: string; qtyPerSet: number }>;
}): Promise<{ soId: string; soLineId: string }> {
  const bom = await bomService.createBomMaster(
    {
      bomNo: `${TEST_PREFIX}${opts.tag}`,
      bomName: `assembly ${opts.tag}`,
      parentItemId: penId,
      status: 'active',
      lines: opts.components.map((c) => ({
        childItemId: c.itemId,
        qtyPerSet: c.qtyPerSet,
        bomType: 'manufacture' as const,
      })),
    },
    admin,
  );

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
      itemId: penId,
      partName: 'PEN',
      orderQty: opts.orderQty,
      rate: '100',
      status: 'open',
      sourceBomMasterId: bom.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();

  await withUserContext(admin, async (tx) => cascadeBomToSoLine(tx, soLine[0]!.id, admin));
  return { soId: so[0]!.id, soLineId: soLine[0]!.id };
}

/** Give the child JC for `itemId` a single process op and complete `qty` on it. */
async function completeChild(soLineId: string, itemId: string, qty: number): Promise<void> {
  const jcs = await db
    .select()
    .from(jobCards)
    .where(eq(jobCards.sourceSoLineId, soLineId));
  const jc = jcs.find((j) => j.itemId === itemId);
  if (!jc) throw new Error(`No cascade JC for item ${itemId}`);

  const op = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: jc.id,
      opSeq: 1,
      machineCodeText: 'TDSPB-M',
      operation: 'turning',
      opType: 'process',
      cycleTimeMin: '0.00',
      qcRequired: false,
      reworkQty: 0,
      outsourceCost: '0.00',
      outsourceSentQty: 0,
      outsourceReturnedQty: 0,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();

  await db.insert(opLog).values({
    companyId: admin.companyId!,
    jcOpId: op[0]!.id,
    logNo: `${TEST_PREFIX}${jc.code}-1`,
    logType: 'complete',
    logDate: '2026-08-02',
    shift: 'day',
    qty,
    rejectQty: 0,
    createdBy: admin.id,
  });
}

/** Credit physical stock so the dispatch on-hand floor is satisfied. */
async function creditStock(itemId: string, qty: number): Promise<void> {
  await db.insert(storeTransactions).values({
    companyId: admin.companyId!,
    txnDate: '2026-08-02',
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'manual_adjust',
    sourceRef: `${TEST_PREFIX}seed`,
    stockBefore: 0,
    stockAfter: qty,
    remarks: 'test seed',
    createdBy: admin.id,
  });
}

async function cleanup(): Promise<void> {
  const ids = itemIds.filter(Boolean);
  const jcs =
    ids.length > 0 ? await db.select({ id: jobCards.id }).from(jobCards).where(inArray(jobCards.itemId, ids)) : [];
  const jcIds = jcs.map((j) => j.id);
  if (jcIds.length > 0) {
    const ops = await db.select({ id: jcOps.id }).from(jcOps).where(inArray(jcOps.jobCardId, jcIds));
    const opIds = ops.map((o) => o.id);
    if (opIds.length > 0) await db.delete(opLog).where(inArray(opLog.jcOpId, opIds));
    await db.delete(jcOps).where(inArray(jcOps.jobCardId, jcIds));
    await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
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
  penId = await makeItem('PEN', 'Pen assembly');
  c1Id = await makeItem('C1', 'Component one');
  c2Id = await makeItem('C2', 'Component two');
  itemIds = [penId, c1Id, c2Id];
});

afterAll(async () => {
  await cleanup();
});

describe('customer dispatch — BOM assembly readiness', () => {
  it('takes the WEAKEST component, not the sum (5 + 4 => 4, never 9)', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'MIN',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 1 },
      ],
    });
    await completeChild(soLineId, c1Id, 5);
    await completeChild(soLineId, c2Id, 4);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(4);
    expect(line.availableQty).toBe(4);
  });

  it('is ready in full when every component covers the order', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'FULL',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 1 },
      ],
    });
    await completeChild(soLineId, c1Id, 10);
    await completeChild(soLineId, c2Id, 10);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(10);
  });

  it('divides by qtyPerSet — 4 of a 2-per-set component covers only 2 assemblies', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'PERSET',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 2 },
      ],
    });
    await completeChild(soLineId, c1Id, 10);
    await completeChild(soLineId, c2Id, 4);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(2);
  });

  it('reports 0 ready while any component has produced nothing', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'ZERO',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 1 },
      ],
    });
    await completeChild(soLineId, c1Id, 7);

    const res = await getDispatchableSo(soId, admin);
    const line = res.lines.find((l) => l.salesOrderLineId === soLineId)!;
    expect(line.readyQty).toBe(0);
  });
});

describe('customer dispatch — BOM assembly stock legs', () => {
  it('debits the components and never the phantom parent, then reverses on cancel', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'STOCK',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 2 },
      ],
    });
    await completeChild(soLineId, c1Id, 5);
    await completeChild(soLineId, c2Id, 8);
    // ready = min(floor(5/1), floor(8/2)) = 4
    await creditStock(c1Id, 5);
    await creditStock(c2Id, 8);

    const dispatch = await createDispatch(
      { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
      admin,
    );

    const outRows = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.sourceType, 'dispatch'));
    const mine = outRows.filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code));
    const outs = mine.filter((r) => r.txnType === 'out');

    // One ledger row per component, at qty x qtyPerSet. Parent absent entirely.
    expect(outs).toHaveLength(2);
    expect(outs.find((r) => r.itemId === c1Id)!.qty).toBe(4);
    expect(outs.find((r) => r.itemId === c2Id)!.qty).toBe(8);
    expect(outs.some((r) => r.itemId === penId)).toBe(false);

    // Cancel puts back exactly what went out.
    await cancelDispatch(dispatch.id, admin);
    const afterRows = await db
      .select()
      .from(storeTransactions)
      .where(eq(storeTransactions.sourceType, 'dispatch'));
    const ins = afterRows
      .filter((r) => (r.sourceRef ?? '').startsWith(dispatch.code))
      .filter((r) => r.txnType === 'in');
    expect(ins).toHaveLength(2);
    expect(ins.find((r) => r.itemId === c1Id)!.qty).toBe(4);
    expect(ins.find((r) => r.itemId === c2Id)!.qty).toBe(8);
  });

  it('refuses to dispatch more assemblies than the weakest component allows', async () => {
    const { soId, soLineId } = await makeAssemblyFixture({
      tag: 'GUARD',
      orderQty: 10,
      components: [
        { itemId: c1Id, qtyPerSet: 1 },
        { itemId: c2Id, qtyPerSet: 1 },
      ],
    });
    await completeChild(soLineId, c1Id, 9);
    await completeChild(soLineId, c2Id, 3);
    await creditStock(c1Id, 9);
    await creditStock(c2Id, 3);

    await expect(
      createDispatch(
        { salesOrderId: soId, dispatchDate: '2026-08-03', lines: [{ salesOrderLineId: soLineId, qty: 4 }] },
        admin,
      ),
    ).rejects.toThrow(/only 3 ready to dispatch/);
  });
});
