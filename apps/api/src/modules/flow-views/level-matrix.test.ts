// Level matrix — per SO line: the line item's live Route Card, and the live
// customer dispatches / tax invoices carrying the line (cancelled ones left
// out), each with THIS line's qty on that document.
//
// NOTE: like every api integration test this writes to the database
// DATABASE_URL points at — never run it against production (house rules).
// Written, not run.

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  customerDispatches,
  customerDispatchLines,
  invoiceLines,
  invoices,
  items,
  routeCards,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TLVM-';

let admin: AuthContext;
let companyId: string;
let soId: string;
let lineId: string;

async function cleanup(): Promise<void> {
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
}, 120_000);

afterAll(cleanup);

describe('flow views — level matrix line docs', () => {
  it('returns the line item Route Card with its revision and approval state', async () => {
    const m = await service.getLevelMatrix(soId, admin);
    const line = m.lines.find((l) => l.id === lineId);
    expect(line?.routeCard).toMatchObject({
      code: `${P}RC`,
      currentRevision: 2,
      approvalStatus: 'pending',
    });
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

  it('a line whose item has no live Route Card reads routeCard null', async () => {
    await db
      .update(routeCards)
      .set({ deletedAt: new Date() })
      .where(like(routeCards.code, `${P}%`));
    try {
      const m = await service.getLevelMatrix(soId, admin);
      expect(m.lines.find((l) => l.id === lineId)?.routeCard).toBeNull();
    } finally {
      await db
        .update(routeCards)
        .set({ deletedAt: null })
        .where(like(routeCards.code, `${P}%`));
    }
  });
});
