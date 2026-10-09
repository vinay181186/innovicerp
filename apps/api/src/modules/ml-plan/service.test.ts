// Multi-Level Plan service tests (ADR-225 phase 3). NOTE: like every api test
// here this writes to the database DATABASE_URL points at — do NOT run it
// against production (house rules). Written, not run.

import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  mlBoms,
  mlPlanNodes,
  mlPlans,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AppError, ConflictError, ValidationError } from '../../lib/errors';
import * as mlBomService from '../ml-bom/service';
import * as soService from '../sales-orders/service';
import { shortCloseSalesOrderLine } from '../sales-orders/short-close';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TMLP-';

let admin: AuthContext;
let companyId: string;
const itemId: Record<string, string> = {};

async function cleanup(): Promise<void> {
  const soIds = (
    await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(like(salesOrders.code, `${P}%`))
  ).map((r) => r.id);
  if (soIds.length > 0) {
    // Nodes cascade with their plan.
    await db.delete(mlPlans).where(inArray(mlPlans.salesOrderId, soIds));
    await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
    await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
  }
  const ids = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(like(items.code, `${P}%`))
  ).map((r) => r.id);
  if (ids.length > 0) await db.delete(mlBoms).where(inArray(mlBoms.itemId, ids));
  await db.delete(items).where(like(items.code, `${P}%`));
}

let soSeq = 0;
/** A fresh SO with one line of `item` × orderQty. */
async function makeSoLine(
  item: string,
  orderQty: number,
  type: 'component_manufacturing' | 'equipment' | 'with_material' = 'component_manufacturing',
): Promise<{ soId: string; lineId: string }> {
  soSeq += 1;
  const so = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO-${Date.now()}-${soSeq}`,
      soDate: '2026-10-09',
      type,
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
  return { soId: so[0]!.id, lineId: line[0]!.id };
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
    ['PLAIN', 'assembly'],
  ];
  const inserted = await db
    .insert(items)
    .values(
      defs.map(([c, t]) => ({
        companyId,
        code: `${P}${c}`,
        name: `ML Plan test ${c}`,
        revision: 'A',
        uom: 'NOS' as const,
        itemType: t,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning({ id: items.id, code: items.code });
  for (const r of inserted) itemId[r.code.slice(P.length)] = r.id;

  // MA10 = 4 × BLT (Buy); PS100 = 1 × MA10 (Manufacture → links MA10's Default)
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
      lines: [{ childItemId: itemId['MA10']!, qtyPerSet: 1, bomType: 'manufacture' }],
    },
    admin,
  );
});

afterAll(cleanup);

describe('ml-plan create', () => {
  it('numbers IN-MLP-#####, copies the tree, pins the BOM Rev, Draft', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    const p = await service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin);
    expect(p.code).toMatch(/^IN-MLP-\d{5}$/);
    expect(p.status).toBe('draft');
    expect(p.mlBomRevision).toBe(1);
    expect(p.bomChanged).toBe(false);
    expect(p.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
    const top = p.nodes[0]!;
    expect([top.grossNeedQty, top.netNeedQty, top.bomType]).toEqual(['5.000', '5.000', null]);
    const ma = p.nodes[1]!;
    expect(ma.isSubAssembly).toBe(true);
    expect(ma.parentNodeId).toBe(top.id);
    // No stock of these fresh items → bolts gross = 5 × 4
    expect(p.nodes[2]!.grossNeedQty).toBe('20.000');
    expect(p.nodes[2]!.raisedQty).toBe('0.000');
    expect(p.nodes[2]!.toRaiseQty).toBe(p.nodes[2]!.netNeedQty);
  });

  it('refuses Plan Qty above the Order Qty', async () => {
    const { lineId } = await makeSoLine('PS100', 3);
    await expect(
      service.createMlPlan({ soLineId: lineId, planQty: 4 }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('two creates on one SO line at once → exactly one wins (§20.3)', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    const results = await Promise.allSettled([
      service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin),
      service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((lost.reason as AppError).statusCode).toBe(409);
    const live = await db
      .select({ id: mlPlans.id })
      .from(mlPlans)
      .where(and(eq(mlPlans.soLineId, lineId), isNull(mlPlans.deletedAt)));
    expect(live).toHaveLength(1);
  });

  it('eligibility refusals: Equipment SO, not an Assembly, no Default BOM, already planned', async () => {
    const eq1 = await makeSoLine('PS100', 2, 'equipment');
    await expect(service.createMlPlan({ soLineId: eq1.lineId, planQty: 1 }, admin)).rejects.toThrow(
      /Component Manufacturing or With Material/,
    );
    const plain = await makeSoLine('PLAIN', 2);
    await expect(
      service.createMlPlan({ soLineId: plain.lineId, planQty: 1 }, admin),
    ).rejects.toThrow(/no Default Multi-Level BOM/);
    const blt = await makeSoLine('BLT', 2);
    await expect(service.createMlPlan({ soLineId: blt.lineId, planQty: 1 }, admin)).rejects.toThrow(
      /not an Assembly/,
    );
    const ok = await makeSoLine('PS100', 2);
    await service.createMlPlan({ soLineId: ok.lineId, planQty: 2 }, admin);
    await expect(service.createMlPlan({ soLineId: ok.lineId, planQty: 1 }, admin)).rejects.toThrow(
      /already planned/,
    );
    const eligible = await service.listEligibleLines({ salesOrderId: ok.soId, limit: 25 }, admin);
    expect(eligible.lines).toHaveLength(0);
  });
});

describe('ml-plan update / cancel', () => {
  it('a stale update is refused 409 (§20.4)', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    const p = await service.createMlPlan({ soLineId: lineId, planQty: 2 }, admin);
    const p2 = await service.updateMlPlan(
      p.id,
      { planQty: 3, expectedUpdatedAt: p.updatedAt },
      admin,
    );
    expect(p2.planQty).toBe(3);
    expect(p2.nodes[2]!.grossNeedQty).toBe('12.000');
    await expect(
      service.updateMlPlan(p.id, { planQty: 4, expectedUpdatedAt: p.updatedAt }, admin),
    ).rejects.toMatchObject({ statusCode: 409 });
    // old nodes are soft-deleted, one live set remains
    const liveNodes = await db
      .select({ id: mlPlanNodes.id })
      .from(mlPlanNodes)
      .where(and(eq(mlPlanNodes.mlPlanId, p.id), isNull(mlPlanNodes.deletedAt)));
    expect(liveNodes).toHaveLength(3);
  });

  it('cancel twice → the second is 409 and names who cancelled', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    const p = await service.createMlPlan({ soLineId: lineId, planQty: 1 }, admin);
    const c = await service.cancelMlPlan(
      p.id,
      { reason: 'test', expectedUpdatedAt: p.updatedAt },
      admin,
    );
    expect(c.status).toBe('cancelled');
    await expect(
      service.cancelMlPlan(p.id, { reason: 'again', expectedUpdatedAt: c.updatedAt }, admin),
    ).rejects.toThrow(/already cancelled/);
    // a cancelled plan frees the line
    const again = await service.createMlPlan({ soLineId: lineId, planQty: 1 }, admin);
    expect(again.status).toBe('draft');
  });

  it('a cancelled plan cannot be updated', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    const p = await service.createMlPlan({ soLineId: lineId, planQty: 1 }, admin);
    const c = await service.cancelMlPlan(p.id, { reason: 'x' }, admin);
    await expect(
      service.updateMlPlan(p.id, { planQty: 2, expectedUpdatedAt: c.updatedAt }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('SO guards', () => {
  it('cancelling the SO is refused while a live Multi-Level Plan exists', async () => {
    const { soId, lineId } = await makeSoLine('PS100', 5);
    const p = await service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin);
    await expect(
      soService.updateSalesOrder(soId, { header: { status: 'cancelled' } }, admin, 'test'),
    ).rejects.toThrow(new RegExp(`${p.code} is planned on this line`));
  });

  it('changing the SO Type is refused while a live Multi-Level Plan exists', async () => {
    const { soId, lineId } = await makeSoLine('PS100', 5);
    await service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin);
    await expect(
      soService.updateSalesOrder(soId, { header: { type: 'equipment' } }, admin),
    ).rejects.toThrow(/SO Type cannot change/);
  });

  it('the next-code preview does not consume a number', async () => {
    const a = await service.getNextMlPlanCode(admin);
    const b = await service.getNextMlPlanCode(admin);
    expect(a.code).toBe(b.code);
  });

  it('closing the line short is refused while a live Multi-Level Plan exists', async () => {
    const { lineId } = await makeSoLine('PS100', 5);
    await service.createMlPlan({ soLineId: lineId, planQty: 5 }, admin);
    await expect(
      shortCloseSalesOrderLine(lineId, { reason: 'test' }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
