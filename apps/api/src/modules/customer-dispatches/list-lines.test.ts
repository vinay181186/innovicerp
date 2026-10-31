// ADR-261 — GET /customer-dispatches/lines: paged on LINES (the register pages
// on dispatches), POL + rev off the SO line, company-scoped. Direct fixtures.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  clients,
  customerDispatchLines,
  customerDispatches,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listDispatchLines } from './list-lines';
import { listDispatchRegister } from './register';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const STAMP = Date.now();
const DSP_CODE = `T261-DSP-${STAMP}`;
let admin: AuthContext;
let soId: string;
let dispatchId: string;

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
  const who = { companyId: u.companyId, createdBy: u.id, updatedBy: u.id };
  soId = (
    await db
      .insert(salesOrders)
      .values({
        ...who,
        code: `T261-DSO-${STAMP}`,
        soDate: '2026-06-01',
        clientId: c.id,
        customerName: 'T261 Client',
        type: 'component_manufacturing',
        status: 'open',
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  const solId = (
    await db
      .insert(salesOrderLines)
      .values({
        ...who,
        salesOrderId: soId,
        lineNo: 1,
        partName: 'T261 P',
        revision: 'D',
        clientPoLineNo: '40',
        orderQty: 10,
      })
      .returning({ id: salesOrderLines.id })
  )[0]!.id;
  dispatchId = (
    await db
      .insert(customerDispatches)
      .values({
        ...who,
        code: DSP_CODE,
        dispatchDate: '2026-06-03',
        salesOrderId: soId,
        soCodeText: `T261-DSO-${STAMP}`,
      })
      .returning({ id: customerDispatches.id })
  )[0]!.id;
  await db.insert(customerDispatchLines).values([
    {
      ...who,
      customerDispatchId: dispatchId,
      lineNo: 1,
      salesOrderLineId: solId,
      itemCodeText: 'T261-IT',
      itemName: 'T261 P',
      qty: 2,
    },
    {
      ...who,
      customerDispatchId: dispatchId,
      lineNo: 2,
      salesOrderLineId: solId,
      itemCodeText: 'T261-IT',
      itemName: 'T261 P',
      qty: 3,
    },
  ]);
});

afterAll(async () => {
  if (dispatchId) {
    await db
      .delete(customerDispatchLines)
      .where(eq(customerDispatchLines.customerDispatchId, dispatchId));
    await db.delete(customerDispatches).where(eq(customerDispatches.id, dispatchId));
  }
  if (soId) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
    await db.delete(salesOrders).where(eq(salesOrders.id, soId));
  }
});

describe('listDispatchLines (ADR-261)', () => {
  it('pages on lines, each row carrying its dispatch and SO-line facts', async () => {
    const page1 = await listDispatchLines({ search: DSP_CODE, limit: 1, offset: 0 }, admin);
    // Two lines of ONE dispatch: total counts lines, a page of 1 holds 1 line.
    expect(page1.total).toBe(2);
    expect(page1.rows).toHaveLength(1);
    expect(page1.summary.dispatchCount).toBe(1);
    const all = await listDispatchLines({ search: DSP_CODE, limit: 25, offset: 0 }, admin);
    expect(all.rows.map((r) => r.qty)).toEqual([2, 3]);
    const r = all.rows[0]!;
    expect(r.dispatchId).toBe(dispatchId);
    expect(r.dispatchCode).toBe(DSP_CODE);
    expect(r.clientPoLineNo).toBe('40');
    expect(r.itemRevision).toBe('D');
    expect(r.billedStatus).toBe('none');
    expect(new Set(all.rows.map((x) => x.lineId)).size).toBe(2);
  });

  it('the register (refactored to share the line SELECT) still pages by dispatch', async () => {
    const reg = await listDispatchRegister({ search: DSP_CODE, limit: 25, offset: 0 }, admin);
    expect(reg.total).toBe(1);
    expect(reg.rows.map((r) => r.qty)).toEqual([2, 3]);
    expect(reg.rows[0]?.clientPoLineNo).toBe('40');
  });

  it('another company sees none of them', async () => {
    const res = await listDispatchLines(
      { search: DSP_CODE, limit: 25, offset: 0 },
      { ...admin, companyId: randomUUID() },
    );
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
