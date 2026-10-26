// Level matrix — per SO line: the live Route Cards that drive it (the line
// item's card first, then each planned item's card — a BOM child plan here),
// the live customer dispatches / tax invoices carrying the line (cancelled ones
// left out, and Billed matching them), each with THIS line's qty; cancelled
// Production Orders and their Job Cards left out; dispatches / invoices hidden
// (docsHidden) from a caller without View on that page.
//
// NOTE: like every api integration test this writes to the database
// DATABASE_URL points at — never run it against production (house rules).
// Written, not run.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  customerDispatches,
  customerDispatchLines,
  invoiceLines,
  invoices,
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
import * as access from '../../lib/access';
import * as poService from '../production-orders/service';
import * as service from './service';

// The real rights check, wrapped so one test can take Invoices View away.
vi.mock('../../lib/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/access')>();
  return { ...actual, hasFormAccess: vi.fn(actual.hasFormAccess) };
});

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TLVM-';

let admin: AuthContext;
let companyId: string;
let soId: string;
let lineId: string;
let livePoId: string;
let cancelledPoId: string;
let cancelledJcId: string;

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
  const ds = await db
    .select({ id: customerDispatches.id })
    .from(customerDispatches)
    .where(like(customerDispatches.code, `${P}%`));
  if (ds.length > 0) {
    const ids = ds.map((d) => d.id);
    await db
      .delete(customerDispatchLines)
      .where(inArray(customerDispatchLines.customerDispatchId, ids));
    await db.delete(customerDispatches).where(inArray(customerDispatches.id, ids));
  }
  const inv = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(like(invoices.code, `${P}%`));
  if (inv.length > 0) {
    const ids = inv.map((i) => i.id);
    await db.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, ids));
    await db.delete(invoices).where(inArray(invoices.id, ids));
  }
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
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await cleanup();
  const by = { createdBy: admin.id, updatedBy: admin.id };

  const it = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}ITM`,
      name: 'Level matrix test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      ...by,
    })
    .returning({ id: items.id });
  const itemId = it[0]!.id;

  await db.insert(routeCards).values({
    companyId,
    code: `${P}RC`,
    itemId,
    currentRevision: 2,
    approvalStatus: 'pending',
    ...by,
  });

  const so = await db
    .insert(salesOrders)
    .values({
      companyId,
      code: `${P}SO`,
      soDate: '2026-10-26',
      customerName: 'Level matrix customer',
      type: 'component_manufacturing',
      status: 'open',
      ...by,
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
      partName: 'Level matrix part',
      orderQty: 10,
      status: 'open',
      ...by,
    })
    .returning({ id: salesOrderLines.id });
  lineId = line[0]!.id;

  // A live dispatch of 4 and a CANCELLED one of 3 (must not show).
  const dLive = await db
    .insert(customerDispatches)
    .values({
      companyId,
      code: `${P}DSP-1`,
      dispatchDate: '2026-10-20',
      salesOrderId: soId,
      status: 'dispatched',
      ...by,
    })
    .returning({ id: customerDispatches.id });
  const dCancelled = await db
    .insert(customerDispatches)
    .values({
      companyId,
      code: `${P}DSP-2`,
      dispatchDate: '2026-10-21',
      salesOrderId: soId,
      status: 'cancelled',
      ...by,
    })
    .returning({ id: customerDispatches.id });
  await db.insert(customerDispatchLines).values([
    {
      companyId,
      customerDispatchId: dLive[0]!.id,
      lineNo: 1,
      salesOrderLineId: lineId,
      itemId,
      itemName: 'Level matrix part',
      qty: 4,
      ...by,
    },
    {
      companyId,
      customerDispatchId: dCancelled[0]!.id,
      lineNo: 1,
      salesOrderLineId: lineId,
      itemId,
      itemName: 'Level matrix part',
      qty: 3,
      ...by,
    },
  ]);

  // A live invoice of 4 and a CANCELLED one of 2 (must not show).
  const iLive = await db
    .insert(invoices)
    .values({
      companyId,
      code: `${P}INV-1`,
      invoiceDate: '2026-10-22',
      salesOrderId: soId,
      status: 'unpaid',
      ...by,
    })
    .returning({ id: invoices.id });
  const iCancelled = await db
    .insert(invoices)
    .values({
      companyId,
      code: `${P}INV-2`,
      invoiceDate: '2026-10-23',
      salesOrderId: soId,
      status: 'cancelled',
      ...by,
    })
    .returning({ id: invoices.id });
  await db.insert(invoiceLines).values([
    {
      companyId,
      invoiceId: iLive[0]!.id,
      lineNo: 1,
      itemId,
      itemName: 'Level matrix part',
      qty: 4,
      salesOrderLineId: lineId,
      ...by,
    },
    {
      companyId,
      invoiceId: iCancelled[0]!.id,
      lineNo: 1,
      itemId,
      itemName: 'Level matrix part',
      qty: 2,
      salesOrderLineId: lineId,
      ...by,
    },
  ]);

  // A BOM child planned on the same line, with its own APPROVED Route Card.
  const child = await db
    .insert(items)
    .values({
      companyId,
      code: `${P}CHILD`,
      name: 'Level matrix child part',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      ...by,
    })
    .returning({ id: items.id });
  const childItemId = child[0]!.id;
  const childRc = await db
    .insert(routeCards)
    .values({
      companyId,
      code: `${P}RC-CHILD`,
      itemId: childItemId,
      approvalStatus: 'approved',
      ...by,
    })
    .returning({ id: routeCards.id });
  const childRcId = childRc[0]!.id;
  await db.insert(routeCardOps).values({
    companyId,
    routeCardId: childRcId,
    opSeq: 10,
    operation: 'Turning',
    opType: 'process',
    ...by,
  });
  const pl = await db
    .insert(plans)
    .values({
      companyId,
      code: `${P}PLN-CHILD`,
      planDate: '2026-10-26',
      planStatus: 'planned',
      planType: 'manufacture',
      opsSource: 'route_card',
      soLineId: lineId,
      itemId: childItemId,
      itemCodeText: `${P}CHILD`,
      orderQty: 2,
      planQty: 2,
      ...by,
    })
    .returning({ id: plans.id });
  const childPlanId = pl[0]!.id;

  // Two orders of 1 on the child plan; the SECOND is then cancelled the way
  // the cancel worker stamps it (deleted_at + cancelled_at, order and card).
  const makePo = () =>
    poService.createProductionOrder(
      {
        planId: childPlanId,
        routeCardId: childRcId,
        targetDate: '2026-11-30',
        orderQty: 1,
        rawMaterialAvailable: true,
      },
      admin,
    );
  livePoId = (await makePo()).id;
  cancelledPoId = (await makePo()).id;
  const now = new Date();
  const cancelled = await db
    .update(productionOrders)
    .set({ deletedAt: now, deletedBy: admin.id, cancelledAt: now, cancelledBy: admin.id })
    .where(eq(productionOrders.id, cancelledPoId))
    .returning({ jcId: productionOrders.jobCardId });
  cancelledJcId = cancelled[0]!.jcId;
  await db
    .update(jobCards)
    .set({ deletedAt: now, deletedBy: admin.id, cancelledAt: now })
    .where(eq(jobCards.id, cancelledJcId));
}, 120_000);

afterAll(cleanup);

describe('flow views — level matrix line docs', () => {
  it('returns the line item Route Card first, then the BOM child plan card', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    const line = m.lines.find((l) => l.id === lineId)!;
    expect(line.routeCards.map((r) => r.code)).toEqual([`${P}RC`, `${P}RC-CHILD`]);
    expect(line.routeCards[0]).toMatchObject({ currentRevision: 2, approvalStatus: 'pending' });
    expect(line.routeCards[1]).toMatchObject({ approvalStatus: 'approved' });
  });

  it('Billed leaves out the cancelled invoice (equals the listed invoices)', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    const line = m.lines.find((l) => l.id === lineId)!;
    expect(line.billedQty).toBe(4);
    expect(line.billedQty).toBe(line.invoices.reduce((s, i) => s + i.qty, 0));
  });

  it('a cancelled Production Order and its Job Card are left out', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    const line = m.lines.find((l) => l.id === lineId)!;
    expect(line.productionOrders.map((o) => o.id)).toEqual([livePoId]);
    expect(line.jobCards.map((j) => j.id)).not.toContain(cancelledJcId);
    expect(line.jobCards.some((j) => j.productionOrderId === livePoId)).toBe(true);
  });

  it('an admin sees both lists: docsHidden all false', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    expect(m.lines.find((l) => l.id === lineId)!.docsHidden).toEqual({
      dispatches: false,
      invoices: false,
    });
  });

  it('a caller without Invoices View gets no invoices and docsHidden.invoices', async () => {
    const real = await vi.importActual<typeof import('../../lib/access')>('../../lib/access');
    const spy = vi.mocked(access.hasFormAccess);
    spy.mockImplementation(async (_user, formKey) => formKey !== 'invoice_create');
    try {
      const m = await service.getLevelMatrix(soId, admin);
      const line = m.lines.find((l) => l.id === lineId)!;
      expect(line.invoices).toEqual([]);
      expect(line.docsHidden).toEqual({ dispatches: false, invoices: true });
      expect(line.dispatches).toHaveLength(1);
      // Billed is a qty the SO detail shows without the Invoices right — it stays.
      expect(line.billedQty).toBe(4);
    } finally {
      spy.mockImplementation(real.hasFormAccess);
    }
  });

  it('lists only live dispatches and invoices, with this line qty, status and date', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    const line = m.lines.find((l) => l.id === lineId)!;
    expect(line.dispatches).toHaveLength(1);
    expect(line.dispatches[0]).toMatchObject({
      code: `${P}DSP-1`,
      qty: 4,
      status: 'dispatched',
      date: '2026-10-20',
    });
    expect(line.invoices).toHaveLength(1);
    expect(line.invoices[0]).toMatchObject({
      code: `${P}INV-1`,
      qty: 4,
      status: 'unpaid',
      date: '2026-10-22',
    });
  });

  it('with no live Route Cards the line reads routeCards []', async () => {
    await db
      .update(routeCards)
      .set({ deletedAt: new Date() })
      .where(like(routeCards.code, `${P}%`));
    try {
      const m = await service.getLevelMatrix(soId, admin);
      expect(m.lines.find((l) => l.id === lineId)?.routeCards).toEqual([]);
    } finally {
      await db
        .update(routeCards)
        .set({ deletedAt: null })
        .where(like(routeCards.code, `${P}%`));
    }
  });
});
