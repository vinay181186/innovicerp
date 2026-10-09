// Multi-Level Plan — Raise orders (ADR-225 phase 4). NOTE: like every api
// test here this writes to the database DATABASE_URL points at — do NOT run it
// against production (house rules). Written, not run.

import { eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  mlBoms,
  mlPlanNodes,
  mlPlans,
  plans,
  purchaseRequests,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import * as mlBomService from '../ml-bom/service';
import * as planService from '../plans/service';
import * as prService from '../purchase-requests/service';
import * as service from './service';
import type { MlPlanDetail } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TMLO-';

let admin: AuthContext;
let companyId: string;
let vendorId: string;
const itemId: Record<string, string> = {};

async function cleanup(): Promise<void> {
  const soIds = (
    await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(like(salesOrders.code, `${P}%`))
  ).map((r) => r.id);
  if (soIds.length > 0) {
    const planIds = (
      await db.select({ id: mlPlans.id }).from(mlPlans).where(inArray(mlPlans.salesOrderId, soIds))
    ).map((r) => r.id);
    if (planIds.length > 0) {
      const nodeIds = (
        await db
          .select({ id: mlPlanNodes.id })
          .from(mlPlanNodes)
          .where(inArray(mlPlanNodes.mlPlanId, planIds))
      ).map((r) => r.id);
      if (nodeIds.length > 0) {
        await db.delete(plans).where(inArray(plans.mlPlanNodeId, nodeIds));
        await db.delete(purchaseRequests).where(inArray(purchaseRequests.mlPlanNodeId, nodeIds));
      }
    }
    await db.delete(mlPlans).where(inArray(mlPlans.salesOrderId, soIds));
    await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
    await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
  }
  await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  const ids = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(like(items.code, `${P}%`))
  ).map((r) => r.id);
  if (ids.length > 0) await db.delete(mlBoms).where(inArray(mlBoms.itemId, ids));
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(vendors).where(like(vendors.code, `${P}%`));
}

let soSeq = 0;
async function makeSoLine(item: string, orderQty: number): Promise<string> {
  soSeq += 1;
  const so = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO-${Date.now()}-${soSeq}`,
      soDate: '2026-10-09',
      type: 'component_manufacturing',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrders.id });
  const line = await db
    .insert(salesOrderLines)
    .values({
      companyId,
      salesOrderId: so[0]!.id,
      lineNo: 1,
      itemId: itemId[item]!,
      partName: item,
      orderQty,
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrderLines.id });
  return line[0]!.id;
}

async function makeRouteCard(item: string, withOp = true): Promise<void> {
  const rc = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-${item}`,
      itemId: itemId[item]!,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: routeCards.id });
  if (withOp) {
    await db.insert(routeCardOps).values({
      companyId,
      routeCardId: rc[0]!.id,
      opSeq: 10,
      operation: 'Turning',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
  }
}

const nodeOf = (d: MlPlanDetail, item: string) =>
  d.nodes.find((n) => n.itemCode === `${P}${item}`)!;

async function newPlan(planQty = 5): Promise<MlPlanDetail> {
  const lineId = await makeSoLine('PS100', 10);
  return service.createMlPlan({ soLineId: lineId, planQty }, admin);
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const defs: Array<[string, 'assembly' | 'component']> = [
    ['PS100', 'assembly'],
    ['MA10', 'assembly'],
    ['BLT', 'component'],
    ['OSP', 'component'],
    ['NORC', 'assembly'],
  ];
  const inserted = await db
    .insert(items)
    .values(
      defs.map(([c, t]) => ({
        companyId,
        code: `${P}${c}`,
        name: `ML orders test ${c}`,
        revision: 'A',
        uom: 'NOS' as const,
        itemType: t,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning({ id: items.id, code: items.code });
  for (const r of inserted) itemId[r.code.slice(P.length)] = r.id;
  const v = await db
    .insert(vendors)
    .values({
      companyId,
      code: `${P}V1`,
      name: 'ML orders vendor',
      createdBy: u.id,
      updatedBy: u.id,
    })
    .returning({ id: vendors.id });
  vendorId = v[0]!.id;

  // PS100 = 1 × MA10 (Manufacture) + 2 × OSP (Outsource)
  // MA10  = 4 × BLT (Buy)
  await mlBomService.createMlBom(
    {
      itemId: itemId['MA10']!,
      lines: [{ childItemId: itemId['BLT']!, qtyPerSet: 4, bomType: 'purchase' }],
    },
    admin,
  );
  await mlBomService.createMlBom(
    {
      itemId: itemId['PS100']!,
      lines: [
        { childItemId: itemId['MA10']!, qtyPerSet: 1, bomType: 'manufacture' },
        { childItemId: itemId['OSP']!, qtyPerSet: 2, bomType: 'outsource' },
      ],
    },
    admin,
  );
  await makeRouteCard('PS100');
  await makeRouteCard('MA10');
});

afterAll(cleanup);

describe('ml-plan raise orders', () => {
  it('raises top + sub-assembly + buy + outsource in one go and releases the plan', async () => {
    const d = await newPlan(5);
    const top = nodeOf(d, 'PS100');
    const ma = nodeOf(d, 'MA10');
    const blt = nodeOf(d, 'BLT');
    const osp = nodeOf(d, 'OSP');
    const out = await service.raiseMlPlanOrders(
      d.id,
      {
        expectedUpdatedAt: d.updatedAt,
        lines: [
          { nodeId: top.id, qty: 5 },
          { nodeId: ma.id, qty: 5 },
          { nodeId: blt.id, qty: 20 },
          { nodeId: osp.id, qty: 10, vendorId, process: 'Plating' },
        ],
      },
      admin,
    );
    expect(out.status).toBe('released');
    expect(out.orders).toHaveLength(4);
    expect(out.orders.every((o) => o.live)).toBe(true);
    for (const n of out.nodes) expect(n.toRaiseQty).toBe('0.000');
    expect(nodeOf(out, 'BLT').raisedQty).toBe('20.000');

    // Top plan carries the SO line; the others do not.
    const made = await db
      .select({ soLineId: plans.soLineId, planType: plans.planType, node: plans.mlPlanNodeId })
      .from(plans)
      .where(inArray(plans.mlPlanNodeId, [top.id, ma.id, osp.id]));
    expect(made).toHaveLength(3);
    expect(made.find((p) => p.node === top.id)!.soLineId).toBe(d.soLineId);
    expect(made.find((p) => p.node === ma.id)!.soLineId).toBeNull();
    expect(made.find((p) => p.node === osp.id)!.planType).toBe('full_outsource');
    const pr = await db
      .select({ src: purchaseRequests.sourceSoLineId, vendor: purchaseRequests.vendorCodeText })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.mlPlanNodeId, blt.id));
    expect(pr).toEqual([{ src: null, vendor: 'TBD' }]);

    // SO line coverage: only the top plan sits on the line.
    const onLine = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.soLineId, d.soLineId));
    expect(onLine).toHaveLength(1);
  });

  it('refuses a qty over To Raise, and a stale screen', async () => {
    const d = await newPlan(5);
    const blt = nodeOf(d, 'BLT');
    await expect(
      service.raiseMlPlanOrders(
        d.id,
        { expectedUpdatedAt: d.updatedAt, lines: [{ nodeId: blt.id, qty: 21 }] },
        admin,
      ),
    ).rejects.toThrow(/only 20 left to raise/);
    const after = await service.raiseMlPlanOrders(
      d.id,
      { expectedUpdatedAt: d.updatedAt, lines: [{ nodeId: blt.id, qty: 12 }] },
      admin,
    );
    expect(nodeOf(after, 'BLT').toRaiseQty).toBe('8.000');
    // The first screen's updatedAt is stale now.
    await expect(
      service.raiseMlPlanOrders(
        d.id,
        { expectedUpdatedAt: d.updatedAt, lines: [{ nodeId: blt.id, qty: 1 }] },
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('two raises on one row at once — exactly one wins, Raised never exceeds Net Need', async () => {
    const d = await newPlan(5);
    const blt = nodeOf(d, 'BLT');
    const one = () =>
      service.raiseMlPlanOrders(d.id, { lines: [{ nodeId: blt.id, qty: 15 }] }, admin);
    const results = await Promise.allSettled([one(), one()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    const total = await db.execute(
      sql`SELECT COALESCE(SUM(qty), 0)::numeric AS q FROM public.purchase_requests
          WHERE ml_plan_node_id = ${blt.id}::uuid AND deleted_at IS NULL`,
    );
    expect(Number((total as unknown as Array<{ q: string }>)[0]!.q)).toBe(15);
  });

  it('a missing route card refuses everything — nothing written', async () => {
    // NORC has no Route Card: a tree whose top row is NORC.
    await mlBomService.createMlBom(
      {
        itemId: itemId['NORC']!,
        lines: [{ childItemId: itemId['BLT']!, qtyPerSet: 1, bomType: 'purchase' }],
      },
      admin,
    );
    const lineId = await makeSoLine('NORC', 3);
    const d = await service.createMlPlan({ soLineId: lineId, planQty: 3 }, admin);
    await expect(
      service.raiseMlPlanOrders(
        d.id,
        {
          lines: [
            { nodeId: nodeOf(d, 'BLT').id, qty: 3 },
            { nodeId: nodeOf(d, 'NORC').id, qty: 3 },
          ],
        },
        admin,
      ),
    ).rejects.toThrow(/NORC has no Route Card — make one first/);
    const after = await service.getMlPlan(d.id, admin);
    expect(after.orders).toHaveLength(0);
    expect(after.status).toBe('draft');
  });

  it('outsource without vendor / process, and a fraction on a plan row, are 400', async () => {
    const d = await newPlan(5);
    await expect(
      service.raiseMlPlanOrders(d.id, { lines: [{ nodeId: nodeOf(d, 'OSP').id, qty: 2 }] }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.raiseMlPlanOrders(
        d.id,
        { lines: [{ nodeId: nodeOf(d, 'MA10').id, qty: 1.5 }] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('cancel is refused while orders are live, allowed once they are gone', async () => {
    const d = await newPlan(5);
    const out = await service.raiseMlPlanOrders(
      d.id,
      {
        lines: [
          { nodeId: nodeOf(d, 'MA10').id, qty: 5 },
          { nodeId: nodeOf(d, 'BLT').id, qty: 20 },
        ],
      },
      admin,
    );
    await expect(service.cancelMlPlan(d.id, { reason: 'test cancel' }, admin)).rejects.toThrow(
      /has live orders: .* — delete \/ cancel them first/,
    );
    const plan = out.orders.find((o) => o.kind === 'plan')!;
    const pr = out.orders.find((o) => o.kind === 'pr')!;
    await planService.softDeletePlan(plan.docId, 'test', admin);
    await prService.rejectPurchaseRequest(pr.docId, 'test', admin);
    const cancelled = await service.cancelMlPlan(d.id, { reason: 'test cancel' }, admin);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.orders.every((o) => !o.live)).toBe(true);
  });

  it('Update / Refresh are refused once released', async () => {
    const d = await newPlan(5);
    const out = await service.raiseMlPlanOrders(
      d.id,
      { lines: [{ nodeId: nodeOf(d, 'BLT').id, qty: 1 }] },
      admin,
    );
    await expect(
      service.updateMlPlan(d.id, { planQty: 4, expectedUpdatedAt: out.updatedAt }, admin),
    ).rejects.toThrow(/only a Draft plan can be changed/);
    await expect(
      service.refreshMlPlan(d.id, { expectedUpdatedAt: out.updatedAt }, admin),
    ).rejects.toThrow(/only a Draft plan can be changed/);
  });

  it('editing a raised plan / PR qty is capped at the row To Raise', async () => {
    const d = await newPlan(5);
    const out = await service.raiseMlPlanOrders(
      d.id,
      {
        lines: [
          { nodeId: nodeOf(d, 'MA10').id, qty: 3 },
          { nodeId: nodeOf(d, 'BLT').id, qty: 10 },
        ],
      },
      admin,
    );
    const plan = out.orders.find((o) => o.kind === 'plan')!;
    const pr = out.orders.find((o) => o.kind === 'pr')!;
    await expect(planService.updatePlan(plan.docId, { planQty: 6 }, admin)).rejects.toThrow(
      /only 5 left to raise on IN-MLP-/,
    );
    await planService.updatePlan(plan.docId, { planQty: 5 }, admin);
    await expect(prService.updatePurchaseRequest(pr.docId, { qty: 21 }, admin)).rejects.toThrow(
      /only 20 left to raise on IN-MLP-/,
    );
    await prService.updatePurchaseRequest(pr.docId, { qty: 20 }, admin);
    const after = await service.getMlPlan(d.id, admin);
    expect(nodeOf(after, 'MA10').toRaiseQty).toBe('0.000');
    expect(nodeOf(after, 'BLT').toRaiseQty).toBe('0.000');
  });
});
