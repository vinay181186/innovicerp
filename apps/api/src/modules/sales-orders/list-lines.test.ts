// ADR-261 — GET /sales-orders/lines: one row per live SO line, order facts on
// every row, company-scoped. Fixtures (SO + lines) are inserted directly.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, salesOrderLines, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listSalesOrderLines } from './list-lines';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const CODE = `T261-SO-${Date.now()}`;
// An SO with no line at all, and one whose every line is cancelled.
const CODE_EMPTY = `${CODE}-E`;
const CODE_CXL = `${CODE}-C`;
let admin: AuthContext;
let soId: string;
let emptyId: string;
let cxlId: string;

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
        customerName: 'T261 Client',
        type: 'component_manufacturing',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
  const head = {
    companyId: u.companyId,
    soDate: '2026-06-01',
    clientId: c.id,
    customerName: 'T261 Client',
    status: 'open' as const,
    createdBy: u.id,
    updatedBy: u.id,
  };
  const others = await db
    .insert(salesOrders)
    .values([
      { ...head, code: CODE_EMPTY, type: 'equipment' },
      { ...head, code: CODE_CXL, type: 'component_manufacturing' },
    ])
    .returning({ id: salesOrders.id, code: salesOrders.code });
  emptyId = others.find((o) => o.code === CODE_EMPTY)!.id;
  cxlId = others.find((o) => o.code === CODE_CXL)!.id;
  const base = { companyId: u.companyId, salesOrderId: soId, createdBy: u.id, updatedBy: u.id };
  await db.insert(salesOrderLines).values([
    {
      ...base,
      lineNo: 1,
      partName: 'T261 L1',
      itemCodeText: 'T261-IT',
      revision: 'B',
      clientPoLineNo: '10',
      orderQty: 3,
      dueDate: '2026-06-10',
    },
    { ...base, lineNo: 2, partName: 'T261 L2', clientPoLineNo: '20', orderQty: 5 },
    // A deleted line never shows.
    { ...base, lineNo: 3, partName: 'T261 L3', orderQty: 7, deletedAt: new Date() },
    // A cancelled line never shows either.
    { ...base, lineNo: 4, partName: 'T261 L4', orderQty: 9, status: 'cancelled' },
    // The every-line-cancelled SO.
    {
      ...base,
      salesOrderId: cxlId,
      lineNo: 1,
      partName: 'T261 C1',
      orderQty: 2,
      status: 'cancelled',
    },
  ]);
});

afterAll(async () => {
  for (const id of [soId, emptyId, cxlId]) {
    if (!id) continue;
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    await db.delete(salesOrders).where(eq(salesOrders.id, id));
  }
});

describe('listSalesOrderLines (ADR-261)', () => {
  it('returns one row per live line, with the order and the line facts', async () => {
    const q = { search: CODE, limit: 50, offset: 0 };
    const res = await listSalesOrderLines(q, admin);
    const rows = res.items.filter((r) => r.id === soId);
    // Deleted (L3) and cancelled (L4) lines are not listed.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.itemName).sort()).toEqual(['T261 L1', 'T261 L2']);
    // 2 lines + the line-less SO + the all-cancelled SO.
    expect(res.total).toBe(4);
    const l1 = rows.find((r) => r.clientPoLineNo === '10')!;
    expect(l1.code).toBe(CODE);
    expect(l1.itemCode).toBe('T261-IT');
    expect(l1.itemRevision).toBe('B');
    expect(l1.itemName).toBe('T261 L1');
    expect(l1.lineOrderQty).toBe(3);
    expect(l1.lineDueDate).toBe('2026-06-10');
    // The order's own aggregates ride on every line — GET /sales-orders' own
    // figures (deleted line excluded; its cancelled line counted, as there).
    expect(l1.totalQty).toBe(17);
    expect(l1.lineCount).toBe(3);
    expect(rows.find((r) => r.clientPoLineNo === '20')?.lineOrderQty).toBe(5);
  });

  it('an SO with no live line still lists as ONE row with null line fields', async () => {
    for (const [code, id] of [
      [CODE_EMPTY, emptyId],
      [CODE_CXL, cxlId],
    ] as const) {
      const res = await listSalesOrderLines({ search: code, limit: 50, offset: 0 }, admin);
      const rows = res.items.filter((r) => r.id === id);
      expect(rows).toHaveLength(1);
      expect(res.total).toBe(1);
      const r = rows[0]!;
      expect(r.code).toBe(code);
      expect(r.lineId).toBeNull();
      expect(r.lineNo).toBeNull();
      expect(r.clientPoLineNo).toBeNull();
      expect(r.itemCode).toBeNull();
      expect(r.lineOrderQty).toBe(0);
    }
  });

  it('an item search keeps only the matching line', async () => {
    const res = await listSalesOrderLines({ search: 'T261 L2', limit: 50, offset: 0 }, admin);
    const rows = res.items.filter((r) => r.id === soId);
    expect(rows.map((r) => r.itemName)).toEqual(['T261 L2']);
  });

  it('another company sees none of them', async () => {
    const res = await listSalesOrderLines(
      { search: CODE, limit: 50, offset: 0 },
      { ...admin, companyId: randomUUID() },
    );
    expect(res.items.filter((r) => r.id === soId)).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
