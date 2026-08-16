// Assembly job work end-to-end (migration 0086).
//
// The client ships components and wants a finished unit back. The JW line names
// a BOM; the cascade spawns one child Job Card per component; readiness is the
// WEAKEST component, not the sum; and returning the assembly consumes the
// COMPONENTS, never the phantom parent.
//
// Job work runs on client-supplied material, so the BOM may contain only
// `manufacture` and `outsource` parts. A `purchase` part is refused with a
// friendly error — asserted here too.

import { and, asc, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasterLines,
  bomMasters,
  clients,
  itemStockBalances,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  jwReturnChallans,
  opLog,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import * as bomService from '../bom-master/service';
import * as jwService from '../job-work-orders/service';
import { cancelJwReturnChallan, createJwReturnChallan } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TJWBOM-';

let admin: AuthContext;
let clientId: string;
let parentId: string;
let c1Id: string;
let c2Id: string;
let boughtId: string;
let itemIds: string[] = [];

async function makeItem(code: string, name: string): Promise<string> {
  const r = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${P}${code}`,
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

async function makeBom(
  tag: string,
  lines: Array<{ itemId: string; qtyPerSet: number; bomType: 'manufacture' | 'purchase' | 'outsource' }>,
): Promise<string> {
  const bom = await bomService.createBomMaster(
    {
      bomNo: `${P}${tag}`,
      bomName: `jw assembly ${tag}`,
      parentItemId: parentId,
      status: 'active',
      lines: lines.map((l) => ({
        childItemId: l.itemId,
        qtyPerSet: l.qtyPerSet,
        bomType: l.bomType,
      })),
    },
    admin,
  );
  return bom.id;
}

/** Create a JWSO through the real service so the gate + cascade both run. */
async function makeJw(tag: string, orderQty: number, bomId: string | undefined) {
  return jwService.createJobWorkOrder(
    {
      header: {
        code: `${P}JW-${tag}`,
        jwDate: '2026-08-01',
        clientId,
        status: 'open',
      },
      lines: [
        {
          partName: 'ASSEMBLY',
          itemCodeText: `${P}PARENT`,
          orderQty,
          uom: 'NOS',
          rate: 250,
          ...(bomId ? { sourceBomMasterId: bomId } : {}),
        },
      ],
    },
    admin,
  );
}

/** Give the child JC for `itemId` one process op and complete `qty` on it. */
async function completeChild(jwLineId: string, itemId: string, qty: number): Promise<void> {
  const jcs = await db.select().from(jobCards).where(eq(jobCards.sourceJwLineId, jwLineId));
  const jc = jcs.find((j) => j.itemId === itemId);
  if (!jc) throw new Error(`No cascade JC for item ${itemId}`);
  const op = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: jc.id,
      opSeq: 1,
      operation: 'turning',
      opType: 'process',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  await db.insert(opLog).values({
    companyId: admin.companyId!,
    jcOpId: op[0]!.id,
    logNo: `${P}${jc.code}-1`,
    logType: 'complete',
    logDate: '2026-08-02',
    shift: 'day',
    qty,
    rejectQty: 0,
    createdBy: admin.id,
  });
}

async function creditStock(itemId: string, qty: number): Promise<void> {
  await db.insert(storeTransactions).values({
    companyId: admin.companyId!,
    txnDate: '2026-08-02',
    itemId,
    txnType: 'in',
    qty,
    sourceType: 'manual_adjust',
    sourceRef: `${P}seed`,
    stockBefore: 0,
    stockAfter: qty,
    remarks: 'test seed',
    createdBy: admin.id,
  });
}

// FK order: challans -> op_log -> jc_ops -> job_cards -> JW (lines cascade)
// -> bom_master_lines -> bom_masters -> store_transactions -> items.
async function cleanup(): Promise<void> {
  const ids = itemIds.filter(Boolean);

  const jwIds = (
    await db.select({ id: jobWorkOrders.id }).from(jobWorkOrders).where(like(jobWorkOrders.code, `${P}%`))
  ).map((r) => r.id);
  if (jwIds.length > 0) {
    const lineIds = (
      await db
        .select({ id: jobWorkOrderLines.id })
        .from(jobWorkOrderLines)
        .where(inArray(jobWorkOrderLines.jobWorkOrderId, jwIds))
    ).map((r) => r.id);
    if (lineIds.length > 0) {
      await db.delete(jwReturnChallans).where(inArray(jwReturnChallans.jobWorkOrderLineId, lineIds));
    }
  }

  if (ids.length > 0) {
    const jcIds = (
      await db.select({ id: jobCards.id }).from(jobCards).where(inArray(jobCards.itemId, ids))
    ).map((r) => r.id);
    if (jcIds.length > 0) {
      const opIds = (
        await db.select({ id: jcOps.id }).from(jcOps).where(inArray(jcOps.jobCardId, jcIds))
      ).map((r) => r.id);
      if (opIds.length > 0) await db.delete(opLog).where(inArray(opLog.jcOpId, opIds));
      await db.delete(jcOps).where(inArray(jcOps.jobCardId, jcIds));
      await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
    }
  }

  if (jwIds.length > 0) await db.delete(jobWorkOrders).where(inArray(jobWorkOrders.id, jwIds));

  const bomIds = (
    await db.select({ id: bomMasters.id }).from(bomMasters).where(like(bomMasters.bomNo, `${P}%`))
  ).map((r) => r.id);
  if (bomIds.length > 0) {
    await db.delete(bomMasterLines).where(inArray(bomMasterLines.bomMasterId, bomIds));
    await db.delete(bomMasters).where(inArray(bomMasters.id, bomIds));
  }

  if (ids.length > 0) {
    await db.delete(storeTransactions).where(inArray(storeTransactions.itemId, ids));
    await db.delete(itemStockBalances).where(inArray(itemStockBalances.itemId, ids));
    await db.delete(items).where(inArray(items.id, ids));
  }
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u?.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const c = (
    await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.companyId, u.companyId), isNull(clients.deletedAt)))
      .orderBy(asc(clients.createdAt))
      .limit(1)
  )[0];
  if (!c) throw new Error('No client in seed company');
  clientId = c.id;

  parentId = await makeItem('PARENT', 'JW assembly parent');
  c1Id = await makeItem('C1', 'JW component one');
  c2Id = await makeItem('C2', 'JW component two');
  boughtId = await makeItem('BUY', 'JW bought part');
  itemIds = [parentId, c1Id, c2Id, boughtId];
});

afterAll(async () => {
  await cleanup();
});

describe('assembly job work — the BOM gate', () => {
  it('refuses a BOM with a bought part, naming it, and creates nothing', async () => {
    const bomId = await makeBom('BUYBOM', [
      { itemId: c1Id, qtyPerSet: 1, bomType: 'manufacture' },
      { itemId: boughtId, qtyPerSet: 1, bomType: 'purchase' },
    ]);

    await expect(makeJw('BAD', 10, bomId)).rejects.toThrow(ValidationError);
    await expect(makeJw('BAD', 10, bomId)).rejects.toThrow(/bought part/i);

    // Nothing persisted — the gate runs before the insert.
    const left = await db
      .select({ id: jobWorkOrders.id })
      .from(jobWorkOrders)
      .where(eq(jobWorkOrders.code, `${P}JW-BAD`));
    expect(left).toHaveLength(0);
  });

  it('accepts manufacture + outsource, spawning a Job Card per component', async () => {
    const bomId = await makeBom('OKBOM', [
      { itemId: c1Id, qtyPerSet: 1, bomType: 'manufacture' },
      { itemId: c2Id, qtyPerSet: 1, bomType: 'outsource' },
    ]);
    const jw = await makeJw('OK', 10, bomId);
    const lineId = jw.lines[0]!.id;

    const jcs = await db.select().from(jobCards).where(eq(jobCards.sourceJwLineId, lineId));
    expect(jcs).toHaveLength(2);
    expect(jcs.every((j) => j.orderQty === 10)).toBe(true);

    // The outsourced component's JC carries an OUTSOURCE op; the machined one
    // does not (its route is planned normally).
    const outsourceJc = jcs.find((j) => j.itemId === c2Id)!;
    const ops = await db.select().from(jcOps).where(eq(jcOps.jobCardId, outsourceJc.id));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.opType).toBe('outsource');

    const machinedJc = jcs.find((j) => j.itemId === c1Id)!;
    const noOps = await db.select().from(jcOps).where(eq(jcOps.jobCardId, machinedJc.id));
    expect(noOps).toHaveLength(0);
  });
});

describe('assembly job work — readiness and stock', () => {
  it('returns the weakest component (5 and 4 => 4) and debits components, not the parent', async () => {
    const bomId = await makeBom('RUN', [
      { itemId: c1Id, qtyPerSet: 1, bomType: 'manufacture' },
      { itemId: c2Id, qtyPerSet: 1, bomType: 'manufacture' },
    ]);
    const jw = await makeJw('RUN', 10, bomId);
    const lineId = jw.lines[0]!.id;

    await completeChild(lineId, c1Id, 5);
    await completeChild(lineId, c2Id, 4);
    await creditStock(c1Id, 5);
    await creditStock(c2Id, 4);

    // 5 is more than the weakest component supports — must be refused at 4.
    await expect(
      createJwReturnChallan(
        { returnDate: '2026-08-03', jobWorkOrderLineId: lineId, qty: 5 },
        admin,
      ),
    ).rejects.toThrow(/produced/i);

    const challan = await createJwReturnChallan(
      { returnDate: '2026-08-03', jobWorkOrderLineId: lineId, qty: 4 },
      admin,
    );

    const outs = (
      await db
        .select()
        .from(storeTransactions)
        .where(eq(storeTransactions.sourceType, 'jw_return'))
    ).filter((r) => (r.sourceRef ?? '').startsWith(challan.code) && r.txnType === 'out');

    expect(outs).toHaveLength(2);
    expect(outs.find((r) => r.itemId === c1Id)!.qty).toBe(4);
    expect(outs.find((r) => r.itemId === c2Id)!.qty).toBe(4);
    expect(outs.some((r) => r.itemId === parentId)).toBe(false);

    // Cancel puts back exactly what went out.
    await cancelJwReturnChallan(challan.id, admin);
    const ins = (
      await db
        .select()
        .from(storeTransactions)
        .where(eq(storeTransactions.sourceType, 'jw_return'))
    ).filter((r) => (r.sourceRef ?? '').startsWith(challan.code) && r.txnType === 'in');
    expect(ins).toHaveLength(2);
    expect(ins.find((r) => r.itemId === c1Id)!.qty).toBe(4);
    expect(ins.find((r) => r.itemId === c2Id)!.qty).toBe(4);
  });

  it('divides by qtyPerSet — 4 of a 2-per-set component covers only 2 assemblies', async () => {
    const bomId = await makeBom('PERSET', [
      { itemId: c1Id, qtyPerSet: 1, bomType: 'manufacture' },
      { itemId: c2Id, qtyPerSet: 2, bomType: 'manufacture' },
    ]);
    const jw = await makeJw('PERSET', 10, bomId);
    const lineId = jw.lines[0]!.id;

    await completeChild(lineId, c1Id, 10);
    await completeChild(lineId, c2Id, 4);
    await creditStock(c1Id, 10);
    await creditStock(c2Id, 4);

    await expect(
      createJwReturnChallan(
        { returnDate: '2026-08-03', jobWorkOrderLineId: lineId, qty: 3 },
        admin,
      ),
    ).rejects.toThrow(/produced/i);

    const ok = await createJwReturnChallan(
      { returnDate: '2026-08-03', jobWorkOrderLineId: lineId, qty: 2 },
      admin,
    );
    const outs = (
      await db
        .select()
        .from(storeTransactions)
        .where(eq(storeTransactions.sourceType, 'jw_return'))
    ).filter((r) => (r.sourceRef ?? '').startsWith(ok.code) && r.txnType === 'out');
    // 2 assemblies x 2 per set = 4 of C2.
    expect(outs.find((r) => r.itemId === c2Id)!.qty).toBe(4);
    expect(outs.find((r) => r.itemId === c1Id)!.qty).toBe(2);
  });

  it('leaves an ordinary (no-BOM) job work line on its own output', async () => {
    const jw = await makeJw('PLAIN', 10, undefined);
    const lineId = jw.lines[0]!.id;
    const jcs = await db.select().from(jobCards).where(eq(jobCards.sourceJwLineId, lineId));
    expect(jcs).toHaveLength(0); // no BOM, no cascade
  });
});
