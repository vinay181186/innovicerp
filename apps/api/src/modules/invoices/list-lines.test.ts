// ADR-261 — GET /invoices/lines: one row per live invoice line, POL + rev off
// the SO line, invoice counts in the strip, company-scoped. Direct fixtures.

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  clients,
  invoiceLines,
  invoices,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listInvoiceLines } from './list-lines';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const STAMP = Date.now();
const INV_CODE = `T261-INV-${STAMP}`;
let admin: AuthContext;
let soId: string;
let invoiceId: string;

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
        code: `T261-ISO-${STAMP}`,
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
        revision: 'C',
        clientPoLineNo: '30',
        orderQty: 10,
      })
      .returning({ id: salesOrderLines.id })
  )[0]!.id;
  invoiceId = (
    await db
      .insert(invoices)
      .values({
        ...who,
        code: INV_CODE,
        invoiceDate: '2026-06-02',
        salesOrderId: soId,
        soCodeText: `T261-ISO-${STAMP}`,
        subtotal: '100',
        gstPercent: '18',
        gstAmount: '18',
        grandTotal: '118',
        totalPaid: '0',
        status: 'unpaid',
      })
      .returning({ id: invoices.id })
  )[0]!.id;
  await db.insert(invoiceLines).values([
    {
      ...who,
      invoiceId,
      lineNo: 1,
      itemCodeText: 'T261-IT',
      itemName: 'T261 P',
      qty: 4,
      rate: '10',
      lineAmount: '40',
      salesOrderLineId: solId,
    },
    {
      ...who,
      invoiceId,
      lineNo: 2,
      itemCodeText: 'T261-IT2',
      itemName: 'T261 Q',
      qty: 6,
      rate: '10',
      lineAmount: '60',
    },
  ]);
});

afterAll(async () => {
  if (invoiceId) {
    await db.delete(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId));
    await db.delete(invoices).where(eq(invoices.id, invoiceId));
  }
  if (soId) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
    await db.delete(salesOrders).where(eq(salesOrders.id, soId));
  }
});

describe('listInvoiceLines (ADR-261)', () => {
  it('returns one row per invoice line, POL + rev off the SO line', async () => {
    const res = await listInvoiceLines({ search: INV_CODE, limit: 25, offset: 0 }, admin);
    const rows = res.rows.filter((r) => r.invoiceId === invoiceId);
    expect(rows).toHaveLength(2);
    expect(res.total).toBe(2);
    const l1 = rows.find((r) => r.itemCode === 'T261-IT')!;
    expect(l1.invoiceCode).toBe(INV_CODE);
    expect(l1.clientPoLineNo).toBe('30');
    expect(l1.itemRevision).toBe('C');
    expect(l1.qty).toBe(4);
    const l2 = rows.find((r) => r.itemCode === 'T261-IT2')!;
    expect(l2.clientPoLineNo).toBeNull();
    expect(l2.itemRevision).toBeNull();
    // The strip counts the ONE invoice, not its two lines.
    expect(res.summary.unpaidCount).toBe(1);
  });

  it('another company sees none of them', async () => {
    const res = await listInvoiceLines(
      { search: INV_CODE, limit: 25, offset: 0 },
      { ...admin, companyId: randomUUID() },
    );
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
