// SO Planning plan summary — the plan item's live Route Card (code + ADR-253
// approval state) and EVERY live Production Order of the plan with its Job
// Card. A Job Card in Trash must come back as jobCardId / jcCode null; a
// CANCELLED order (ADR-235) is left out altogether.
//
// NOTE: like every api integration test this writes to the database
// DATABASE_URL points at — never run it against production (house rules).
// Written, not run.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  items,
  jobCards,
  plans,
  productionOrders,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as poService from '../production-orders/service';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TSPPO-';

let admin: AuthContext;
let companyId: string;
let itemId: string;
let soId: string;
let planId: string;
const poIds: string[] = [];
let cancelledPoId: string;

async function cleanup(): Promise<void> {
  const pos = await db
    .select({ id: productionOrders.id, jcId: productionOrders.jobCardId })
    .from(productionOrders)
    .where(like(productionOrders.planCodeText, `${P}%`));
  const jcIds = pos.map((p) => p.jcId);
  if (jcIds.length > 0) {
    await db.update(jobCards).set({ productionOrderId: null }).where(inArray(jobCards.id, jcIds));
    await db.delete(productionOrders).where(
      inArray(
        productionOrders.id,
        pos.map((p) => p.id),
      ),
    );
  }
  await db.delete(plans).where(like(plans.code, `${P}%`));
  if (jcIds.length > 0) await db.delete(jobCards).where(inArray(jobCards.id, jcIds));
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${P}%`));
  for (const so of sos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
  poIds.length = 0;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();

  const it = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}ITM`,
      name: 'Plan orders test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: items.id });
  itemId = it[0]!.id;

  const rc = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC`,
      itemId,
      approvalStatus: 'approved',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: routeCards.id });
  const routeCardId = rc[0]!.id;
  await db.insert(routeCardOps).values({
    companyId,
    routeCardId,
    opSeq: 10,
    operation: 'Turning',
    opType: 'process',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  const so = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO`,
      soDate: '2026-10-26',
      customerName: 'Plan orders customer',
      type: 'component_manufacturing',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrders.id });
  soId = so[0]!.id;
  const line = await db
    .insert(salesOrderLines)
    .values({
      companyId,
      salesOrderId: soId,
      lineNo: 1,
      itemId,
      partName: 'Plan orders part',
      orderQty: 5,
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: salesOrderLines.id });

  const pl = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN`,
      planDate: '2026-10-26',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      soLineId: line[0]!.id,
      itemId,
      itemCodeText: `${P}ITM`,
      orderQty: 5,
      planQty: 5,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning({ id: plans.id });
  planId = pl[0]!.id;

  // Two orders of 2 on the plan of 5 — oldest first in the summary.
  for (let i = 0; i < 2; i++) {
    const po = await poService.createProductionOrder(
      { planId, routeCardId, targetDate: '2026-11-30', orderQty: 2, rawMaterialAvailable: true },
      admin,
    );
    poIds.push(po.id);
  }

  // Send the SECOND order's Job Card to Trash.
  const second = await db
    .select({ jcId: productionOrders.jobCardId })
    .from(productionOrders)
    .where(eq(productionOrders.id, poIds[1]!));
  await db
    .update(jobCards)
    .set({ deletedAt: new Date(), deletedBy: admin.id })
    .where(eq(jobCards.id, second[0]!.jcId));

  // A third order of 1, then CANCELLED the way the cancel worker stamps it
  // (deleted_at + cancelled_at on the order and on its Job Card).
  const third = await poService.createProductionOrder(
    { planId, routeCardId, targetDate: '2026-11-30', orderQty: 1, rawMaterialAvailable: true },
    admin,
  );
  cancelledPoId = third.id;
  const now = new Date();
  const thirdRow = await db
    .update(productionOrders)
    .set({ deletedAt: now, deletedBy: admin.id, cancelledAt: now, cancelledBy: admin.id })
    .where(eq(productionOrders.id, cancelledPoId))
    .returning({ jcId: productionOrders.jobCardId });
  await db
    .update(jobCards)
    .set({ deletedAt: now, deletedBy: admin.id, cancelledAt: now })
    .where(eq(jobCards.id, thirdRow[0]!.jcId));
}, 120_000);

afterAll(cleanup);

describe('so-planning — plan summary route card + every production order', () => {
  it('returns the live Route Card code and approval state, and all orders with their JCs', async () => {
    const detail = await service.getPlanningSoDetail(soId, admin);
    const plan = detail.lines.flatMap((l) => l.plans).find((p) => p.id === planId);
    expect(plan).toBeDefined();
    expect(plan!.routeCardCode).toBe(`${P}RC`);
    expect(plan!.routeCardApprovalStatus).toBe('approved');

    expect(plan!.productionOrders.map((o) => o.id)).toEqual(poIds);
    const first = plan!.productionOrders[0]!;
    expect(first.status).toBe('open');
    expect(first.jobCardId).toBeTruthy();
    expect(first.jcCode).toBeTruthy();
    // productionOrderCode stays the NEWEST order.
    expect(plan!.productionOrderCode).toBe(plan!.productionOrders[1]!.code);
  });

  it('a Job Card in Trash comes back as jobCardId / jcCode null', async () => {
    const detail = await service.getPlanningSoDetail(soId, admin);
    const plan = detail.lines.flatMap((l) => l.plans).find((p) => p.id === planId)!;
    const trashed = plan.productionOrders.find((o) => o.id === poIds[1]);
    expect(trashed).toBeDefined();
    expect(trashed!.jobCardId).toBeNull();
    expect(trashed!.jcCode).toBeNull();
  });

  it('a cancelled Production Order is not listed on the plan', async () => {
    const detail = await service.getPlanningSoDetail(soId, admin);
    const plan = detail.lines.flatMap((l) => l.plans).find((p) => p.id === planId)!;
    expect(plan.productionOrders.map((o) => o.id)).not.toContain(cancelledPoId);
    expect(plan.productionOrders).toHaveLength(2);
  });

  it('a plan whose item has no live Route Card reads null / null', async () => {
    await db
      .update(routeCards)
      .set({ deletedAt: new Date() })
      .where(like(routeCards.code, `${P}%`));
    try {
      const detail = await service.getPlanningSoDetail(soId, admin);
      const plan = detail.lines.flatMap((l) => l.plans).find((p) => p.id === planId)!;
      expect(plan.routeCardCode).toBeNull();
      expect(plan.routeCardApprovalStatus).toBeNull();
    } finally {
      await db
        .update(routeCards)
        .set({ deletedAt: null })
        .where(like(routeCards.code, `${P}%`));
    }
  });
});
