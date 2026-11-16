// ADR-303 — GET /sales-orders (SO Master) is ONE ROW PER ORDER again: an SO
// with five lines is one row; Lines counts the non-deleted lines; Total Value
// (Basic) and Value to Dispatch are the money columns (no GST), with a
// short-closed and a cancelled line; the SO dropdown (sf soCode) and an item
// search each return the order once. Fixtures are inserted directly.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, salesOrderLines, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listSalesOrders } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const CODE = `T303-SO-${Date.now()}`;
let admin: AuthContext;
let soId: string;

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
  soId = (
    await db
      .insert(salesOrders)
      .values({
        companyId: u.companyId,
        code: CODE,
        soDate: '2026-06-01',
        clientId: c.id,
        customerName: 'T303 Client',
        type: 'component_manufacturing',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  const base = { companyId: u.companyId, salesOrderId: soId, createdBy: u.id, updatedBy: u.id };
  await db.insert(salesOrderLines).values([
    // 10 × 100.50 = 1005.00; 6 still to dispatch → 603.00
    {
      ...base,
      lineNo: 1,
      partName: 'T303 L1',
      itemCodeText: 'T303-IT1',
      orderQty: 10,
      rate: '100.50',
      dispatchedQty: 4,
      dueDate: '2026-06-20',
    },
    // 5 × 20 = 100; nothing dispatched → 100
    {
      ...base,
      lineNo: 2,
      partName: 'T303 L2',
      itemCodeText: 'T303-IT2',
      orderQty: 5,
      rate: '20',
      dueDate: '2026-06-10',
    },
    // Short-closed: 8 × 10 = 80 counts in Total Value (Basic), 0 to dispatch.
    {
      ...base,
      lineNo: 3,
      partName: 'T303 L3',
      orderQty: 8,
      rate: '10',
      dispatchedQty: 3,
      shortClosedAt: new Date(),
      shortClosedBy: u.id,
      shortCloseReason: 'T303 test',
    },
    // Cancelled: no value at all (still a non-deleted line → counted in Lines).
    { ...base, lineNo: 4, partName: 'T303 L4', orderQty: 9, rate: '50', status: 'cancelled' },
    // Fully dispatched: 2 × 7.25 = 14.50, 0 to dispatch.
    { ...base, lineNo: 5, partName: 'T303 L5', orderQty: 2, rate: '7.25', dispatchedQty: 2 },
    // Deleted: never counted anywhere.
    { ...base, lineNo: 6, partName: 'T303 L6', orderQty: 100, rate: '1', deletedAt: new Date() },
  ]);
});

afterAll(async () => {
  if (!soId) return;
  await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
  await db.delete(salesOrders).where(eq(salesOrders.id, soId));
});

describe('listSalesOrders — one row per order (ADR-303)', () => {
  it('an SO with five lines is ONE row with Lines = 5 and the two values', async () => {
    const res = await listSalesOrders({ search: CODE, limit: 25, offset: 0 }, admin);
    const rows = res.items.filter((r) => r.id === soId);
    expect(rows).toHaveLength(1);
    expect(res.total).toBe(1);
    const so = rows[0]!;
    expect(so.lineCount).toBe(5);
    // Σ qty × rate over non-cancelled lines, before GST (short-closed counts).
    expect(so.totalValueBasic).toBe(1199.5);
    // Σ (order − dispatched − short-closed, floor 0) × rate, cancelled out.
    expect(so.valueToDispatch).toBe(703);
    // Due Date = the earliest line due date.
    expect(so.earliestDueDate).toBe('2026-06-10');
  });

  it('an item code on one line finds the order once', async () => {
    const res = await listSalesOrders({ search: 'T303-IT2', limit: 25, offset: 0 }, admin);
    expect(res.items.filter((r) => r.id === soId)).toHaveLength(1);
  });

  it('the SO dropdown filter (sf soCode) returns the order once', async () => {
    const sf = JSON.stringify({
      sort: null,
      filters: [{ field: 'soCode', kind: 'values', values: [CODE] }],
    });
    const res = await listSalesOrders({ sf, limit: 25, offset: 0 }, admin);
    expect(res.items.map((r) => r.id)).toEqual([soId]);
    expect(res.total).toBe(1);
  });

  it('sorts / filters on Lines and Total Value (Basic) on the server', async () => {
    const sf = JSON.stringify({
      sort: { field: 'totalValueBasic', dir: 'desc' },
      filters: [
        { field: 'soCode', kind: 'values', values: [CODE] },
        { field: 'lineCount', kind: 'num', op: 'eq', a: 5 },
        { field: 'valueToDispatch', kind: 'num', op: 'eq', a: 703 },
      ],
    });
    const res = await listSalesOrders({ sf, limit: 25, offset: 0 }, admin);
    expect(res.items.map((r) => r.id)).toEqual([soId]);
  });

  it('another company sees none of it', async () => {
    const res = await listSalesOrders(
      { search: CODE, limit: 25, offset: 0 },
      { ...admin, companyId: randomUUID() },
    );
    expect(res.total).toBe(0);
  });
});
