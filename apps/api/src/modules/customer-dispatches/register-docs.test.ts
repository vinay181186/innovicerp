// ADR-303 — the Customer Dispatch list is ONE ROW PER DISPATCH again: the
// register's `docs` carry one entry per dispatch (Lines, Dispatch Qty over all
// its lines, "+n" other SOs), and the SO dropdown (sf soCode) finds a dispatch
// through ANY of its lines' SOs, still once. Direct fixtures.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
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
import { listDispatchRegister } from './register';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const STAMP = Date.now();
const DSP_CODE = `T303-DSP-${STAMP}`;
const SO_A = `T303-DSOA-${STAMP}`;
const SO_B = `T303-DSOB-${STAMP}`;
let admin: AuthContext;
let soIds: string[] = [];
let dispatchId: string;

const soFilter = (code: string): string =>
  JSON.stringify({ sort: null, filters: [{ field: 'soCode', kind: 'values', values: [code] }] });

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
  const sos = await db
    .insert(salesOrders)
    .values(
      [SO_A, SO_B].map((code) => ({
        ...who,
        code,
        soDate: '2026-06-01',
        clientId: c.id,
        customerName: 'T303 Client',
        type: 'component_manufacturing' as const,
        status: 'open' as const,
      })),
    )
    .returning({ id: salesOrders.id, code: salesOrders.code });
  soIds = sos.map((s) => s.id);
  const idA = sos.find((s) => s.code === SO_A)!.id;
  const idB = sos.find((s) => s.code === SO_B)!.id;
  const sols = await db
    .insert(salesOrderLines)
    .values([
      { ...who, salesOrderId: idA, lineNo: 1, partName: 'T303 A', orderQty: 10 },
      { ...who, salesOrderId: idB, lineNo: 1, partName: 'T303 B', orderQty: 10 },
    ])
    .returning({ id: salesOrderLines.id, soId: salesOrderLines.salesOrderId });
  const solA = sols.find((s) => s.soId === idA)!.id;
  const solB = sols.find((s) => s.soId === idB)!.id;
  // The dispatch's header SO is A; one of its three lines ships against B.
  dispatchId = (
    await db
      .insert(customerDispatches)
      .values({
        ...who,
        code: DSP_CODE,
        dispatchDate: '2026-06-03',
        salesOrderId: idA,
        soCodeText: SO_A,
      })
      .returning({ id: customerDispatches.id })
  )[0]!.id;
  const line = { ...who, customerDispatchId: dispatchId, itemName: 'T303 P' };
  await db.insert(customerDispatchLines).values([
    { ...line, lineNo: 1, salesOrderLineId: solA, itemCodeText: 'T303-ITA', qty: 2 },
    { ...line, lineNo: 2, salesOrderLineId: solA, itemCodeText: 'T303-ITA', qty: 3 },
    { ...line, lineNo: 3, salesOrderLineId: solB, itemCodeText: 'T303-ITB', qty: 4 },
  ]);
});

afterAll(async () => {
  if (dispatchId) {
    await db
      .delete(customerDispatchLines)
      .where(eq(customerDispatchLines.customerDispatchId, dispatchId));
    await db.delete(customerDispatches).where(eq(customerDispatches.id, dispatchId));
  }
  if (soIds.length) {
    await db.delete(salesOrderLines).where(inArray(salesOrderLines.salesOrderId, soIds));
    await db.delete(salesOrders).where(inArray(salesOrders.id, soIds));
  }
});

describe('listDispatchRegister docs (ADR-303)', () => {
  it('a three-line dispatch is ONE doc with Lines, Dispatch Qty and +1 other SO', async () => {
    const reg = await listDispatchRegister({ search: DSP_CODE, limit: 25, offset: 0 }, admin);
    expect(reg.total).toBe(1);
    expect(reg.docs).toHaveLength(1);
    const d = reg.docs![0]!;
    expect(d.dispatchId).toBe(dispatchId);
    expect(d.soNo).toBe(SO_A);
    expect(d.lineCount).toBe(3);
    expect(d.totalQty).toBe(9);
    expect(d.extraSoCount).toBe(1);
    expect(d.billedStatus).toBe('none');
  });

  it('an item code on one line finds the dispatch once, Dispatch Qty still over ALL lines', async () => {
    const reg = await listDispatchRegister({ search: 'T303-ITB', limit: 25, offset: 0 }, admin);
    const docs = (reg.docs ?? []).filter((d) => d.dispatchId === dispatchId);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.totalQty).toBe(9);
  });

  it('the SO dropdown finds it by the header SO and by a line SO, once each', async () => {
    for (const code of [SO_A, SO_B]) {
      const reg = await listDispatchRegister({ sf: soFilter(code), limit: 25, offset: 0 }, admin);
      expect((reg.docs ?? []).map((d) => d.dispatchId)).toEqual([dispatchId]);
      expect(reg.total).toBe(1);
    }
  });
});
