// Fixture for list-lines.test.ts (TEST database only, never imported by app code).
// Inserted directly, except the Production Orders (the real service, as
// plan-orders.test does).
//
//   JWSO  Ln 1 unplanned · Ln 2 half planned · Ln 3 closed short, a draft plan left
//         on it · Ln 4 a direct JC + a rework child · Ln 5 cancelled
//   SO    Ln 1 unplanned · Ln 2 Buy line covered by its PR · Ln 3 plan with 2 PROs
//   Equipment SO  Ln 1 the machine, part plans 10 + 4 · Ln 2 a spare part, own plan
//   Closed SO     must not appear at all

import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasters,
  items,
  jobCards,
  jobWorkOrderLines,
  jobWorkOrders,
  plans,
  productionOrders,
  purchaseRequests,
  routeCardOps,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as poService from '../production-orders/service';

export const P = 'TSPLL-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
export const JW_CODE = `${P}JW-A`;
export const SO_CODE = `${P}SO-A`;
export const EQ_CODE = `${P}SO-EQ`;
export const CLOSED_CODE = `${P}SO-CLOSED`;
export const POL_LINE_3 = `${P}POL-A3`;

export interface PlanningLinesFixture {
  admin: AuthContext;
  jwId: string;
  soId: string;
  eqId: string;
  proCode: string;
}

export async function cleanupPlanningLinesFixture(): Promise<void> {
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `${P}%`));
  const pos = await db
    .select({ id: productionOrders.id, jcId: productionOrders.jobCardId })
    .from(productionOrders)
    .where(like(productionOrders.planCodeText, `${P}%`));
  const proJcIds = pos.map((p) => p.jcId);
  if (proJcIds.length > 0) {
    await db
      .update(jobCards)
      .set({ productionOrderId: null })
      .where(inArray(jobCards.id, proJcIds));
    await db.delete(productionOrders).where(
      inArray(
        productionOrders.id,
        pos.map((p) => p.id),
      ),
    );
  }
  await db.delete(plans).where(like(plans.code, `${P}%`));
  if (proJcIds.length > 0) await db.delete(jobCards).where(inArray(jobCards.id, proJcIds));
  await db.delete(jobCards).where(like(jobCards.code, `${P}%`));
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${P}%`));
  for (const so of sos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  // JW lines cascade on the parent delete; BOM lines too.
  await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${P}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${P}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${P}%`));
  await db.delete(items).where(like(items.code, `${P}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${P}%`));
}

export async function setupPlanningLinesFixture(): Promise<PlanningLinesFixture> {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u?.companyId) throw new Error('Seed admin missing');
  const admin: AuthContext = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  const companyId = u.companyId;
  const who = { companyId, createdBy: u.id, updatedBy: u.id };
  await cleanupPlanningLinesFixture();

  const item = async (suffix: string, procurementType: 'make' | 'buy' = 'make') =>
    (
      await db
        .insert(items)
        .values({
          ...who,
          code: `${P}${suffix}`,
          name: `Item ${suffix}`,
          revision: 'A',
          uom: 'NOS',
          itemType: 'component',
          procurementType,
        })
        .returning({ id: items.id })
    )[0]!.id;
  const makeItem = await item('ITM');
  const buyItem = await item('BUY', 'buy');
  const machine = await item('MACHINE');
  const part1 = await item('P1');
  const part2 = await item('P2');

  const plan = (code: string, values: Partial<typeof plans.$inferInsert>) => ({
    ...who,
    code: `${P}${code}`,
    planDate: '2026-11-01',
    planStatus: 'in_planning' as const,
    planType: 'manufacture' as const,
    orderQty: 10,
    planQty: 5,
    itemId: makeItem,
    itemCodeText: `${P}ITM`,
    ...values,
  });
  const jobCard = (code: string, values: Partial<typeof jobCards.$inferInsert>) => ({
    ...who,
    code: `${P}${code}`,
    jcDate: '2026-11-01',
    itemId: makeItem,
    orderQty: 1,
    ...values,
  });

  // ── JWSO with 4 live lines and a cancelled one. Inserted out of order, so the
  // Ln order on the list comes from the query and not from insert order.
  const jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        ...who,
        code: JW_CODE,
        jwDate: '2026-11-01',
        customerName: 'JW Customer',
        status: 'open',
      })
      .returning({ id: jobWorkOrders.id })
  )[0]!.id;
  const jwLine = (lineNo: number, values: Partial<typeof jobWorkOrderLines.$inferInsert> = {}) => ({
    ...who,
    jobWorkOrderId: jwId,
    lineNo,
    itemId: makeItem,
    partName: `JW part ${lineNo}`,
    clientPoLineNo: `${P}JWPOL-${lineNo}`,
    orderQty: 10,
    dueDate: '2026-12-01',
    status: 'open' as const,
    ...values,
  });
  const jwLines = await db
    .insert(jobWorkOrderLines)
    .values([
      jwLine(3, {
        status: 'closed',
        shortClosedAt: new Date(),
        shortClosedBy: u.id,
        shortCloseReason: 'Customer closed the order',
      }),
      jwLine(1),
      jwLine(5, { status: 'cancelled' }),
      jwLine(4),
      jwLine(2),
    ])
    .returning({ id: jobWorkOrderLines.id, lineNo: jobWorkOrderLines.lineNo });
  const jwLineId = (n: number) => jwLines.find((l) => l.lineNo === n)!.id;

  await db.insert(plans).values([
    // Ln 2: half planned.
    plan('PL-JW2', { jwLineId: jwLineId(2) }),
    // Ln 3 is closed short: a draft plan left on it must not drag it to partial.
    plan('PL-JW3', { jwLineId: jwLineId(3), planQty: 2 }),
  ]);
  // Ln 4: one real direct JC + one rework child, which is not extra coverage.
  await db.insert(jobCards).values([
    jobCard('JC-JW4-DIRECT', { sourceJwLineId: jwLineId(4), orderQty: 2 }),
    jobCard('JC-JW4-REWORK', {
      sourceJwLineId: jwLineId(4),
      orderQty: 3,
      recoveryKind: 'rework',
    }),
  ]);

  // ── SO: Ln 1 unplanned, Ln 2 a Buy line covered by its PR, Ln 3 a plan with
  // two Production Orders.
  const soId = (
    await db
      .insert(salesOrders)
      .values({
        ...who,
        code: SO_CODE,
        soDate: '2026-11-01',
        customerName: 'SO Customer',
        type: 'component_manufacturing',
        status: 'open',
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  const soLine = (
    salesOrderId: string,
    lineNo: number,
    values: Partial<typeof salesOrderLines.$inferInsert> = {},
  ) => ({
    ...who,
    salesOrderId,
    lineNo,
    itemId: makeItem,
    partName: `SO part ${lineNo}`,
    orderQty: 10,
    status: 'open' as const,
    ...values,
  });
  const soLines = await db
    .insert(salesOrderLines)
    .values([
      soLine(soId, 1),
      soLine(soId, 2, { itemId: buyItem }),
      soLine(soId, 3, { clientPoLineNo: POL_LINE_3 }),
    ])
    .returning({ id: salesOrderLines.id, lineNo: salesOrderLines.lineNo });
  const soLineId = (n: number) => soLines.find((l) => l.lineNo === n)!.id;

  await db.insert(purchaseRequests).values({
    ...who,
    code: `${P}PR-1`,
    prDate: '2026-11-01',
    status: 'open',
    prType: 'standard',
    vendorCodeText: 'TBD',
    itemId: buyItem,
    itemCodeText: `${P}BUY`,
    itemName: 'Item BUY',
    qty: 4,
    estCost: '0',
    sourceSoLineId: soLineId(2),
  });

  const routeCardId = (
    await db
      .insert(routeCards)
      .values({ ...who, code: `${P}RC`, itemId: makeItem, approvalStatus: 'approved' })
      .returning({ id: routeCards.id })
  )[0]!.id;
  await db.insert(routeCardOps).values({
    ...who,
    routeCardId,
    opSeq: 10,
    operation: 'Turning',
    opType: 'process',
  });
  const planWithPros = (
    await db
      .insert(plans)
      .values(
        plan('PL-SO3', {
          soLineId: soLineId(3),
          planStatus: 'planned',
          opsSource: 'route_card',
          // ADR-218 — a Production Order on an SO-line plan needs its raw material.
          rawMaterialGradeText: 'EN8',
          rawMaterialSizeText: '50 DIA',
        }),
      )
      .returning({ id: plans.id })
  )[0]!.id;
  const pros = [];
  for (let i = 0; i < 2; i++) {
    pros.push(
      await poService.createProductionOrder(
        {
          planId: planWithPros,
          routeCardId,
          targetDate: '2026-12-01',
          orderQty: 2,
          rawMaterialAvailable: true,
        },
        admin,
      ),
    );
  }
  const proCode = pros[1]!.code;

  // ── Equipment SO: part plans 10 + 4 at 1 per set make 4 complete sets (ADR-221).
  // The spare-part line on the same SO is an ordinary line.
  const bomId = (
    await db
      .insert(bomMasters)
      .values({ ...who, bomNo: `${P}BOM`, bomName: 'Machine BOM', parentItemId: machine })
      .returning({ id: bomMasters.id })
  )[0]!.id;
  await db.insert(bomMasterLines).values([
    {
      ...who,
      bomMasterId: bomId,
      lineNo: 1,
      childItemId: part1,
      qtyPerSet: '1',
      bomType: 'manufacture' as const,
    },
    {
      ...who,
      bomMasterId: bomId,
      lineNo: 2,
      childItemId: part2,
      qtyPerSet: '1',
      bomType: 'manufacture' as const,
    },
  ]);
  const eqId = (
    await db
      .insert(salesOrders)
      .values({
        ...who,
        code: EQ_CODE,
        soDate: '2026-11-01',
        customerName: 'Equipment Customer',
        type: 'equipment',
        bomMasterId: bomId,
        status: 'open',
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  const eqLines = await db
    .insert(salesOrderLines)
    .values([soLine(eqId, 1, { itemId: machine }), soLine(eqId, 2, { itemId: part1 })])
    .returning({ id: salesOrderLines.id, lineNo: salesOrderLines.lineNo });
  const machineLine = eqLines.find((l) => l.lineNo === 1)!.id;
  const spareLine = eqLines.find((l) => l.lineNo === 2)!.id;
  const partPlan = (code: string, childItem: string, childCode: string, planQty: number) =>
    plan(code, {
      soLineId: machineLine,
      itemId: childItem,
      itemCodeText: childCode,
      bomMasterId: bomId,
      bomChildCode: childCode,
      planQty,
    });
  await db
    .insert(plans)
    .values([
      partPlan('PL-EQ-P1', part1, `${P}P1`, 10),
      partPlan('PL-EQ-P2', part2, `${P}P2`, 4),
      plan('PL-EQ-SPARE', { soLineId: spareLine, itemId: part1, planQty: 3 }),
    ]);

  // ── A closed order's line is not on the list.
  const closedId = (
    await db
      .insert(salesOrders)
      .values({
        ...who,
        code: CLOSED_CODE,
        soDate: '2026-11-01',
        customerName: 'Closed Customer',
        type: 'component_manufacturing',
        status: 'closed',
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  await db.insert(salesOrderLines).values(soLine(closedId, 1));

  return { admin, jwId, soId, eqId, proCode };
}
