// Invoice cancel guard tests (ADR-202 Phase 3). An invoice is a statutory GST
// document, so a correction is a reason-logged CANCEL, not an edit. Fixtures
// (SO + invoice rows) are inserted directly; cancel is tested in isolation.

import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  clients,
  invoicePayments,
  invoices,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
let soId: string;
const createdInvoiceIds: string[] = [];

async function insertInvoice(suffix: string): Promise<string> {
  const row = (
    await db
      .insert(invoices)
      .values({
        companyId: admin.companyId!,
        code: `T202-INV-${Date.now()}-${suffix}`,
        invoiceDate: '2026-06-01',
        salesOrderId: soId,
        soCodeText: 'T202-SO',
        subtotal: '100',
        gstPercent: '18',
        gstAmount: '18',
        grandTotal: '118',
        totalPaid: '0',
        status: 'unpaid',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: invoices.id })
  )[0]!.id;
  createdInvoiceIds.push(row);
  return row;
}

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
        companyId: admin.companyId!,
        code: `T202-SO-${Date.now()}`,
        soDate: '2026-06-01',
        clientId: c.id,
        customerName: 'T202 Client',
        type: 'component_manufacturing',
        status: 'open',
        gstPercent: '18',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: salesOrders.id })
  )[0]!.id;
});

afterAll(async () => {
  for (const id of createdInvoiceIds) {
    await db.delete(invoicePayments).where(eq(invoicePayments.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
  }
  await db.delete(salesOrders).where(eq(salesOrders.id, soId));
});

describe('invoices cancel (ADR-202 Phase 3)', () => {
  it('cancels an unpaid invoice: status cancelled, stamps set, row kept', async () => {
    const id = await insertInvoice('ok');
    const out = await service.cancelInvoice(id, { reason: 'Wrong GST rate — reissue' }, admin);
    expect(out.status).toBe('cancelled');

    // Row is kept (the INV-#### series is never deleted) and the cancel stamps
    // are written.
    const row = (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
    expect(row.status).toBe('cancelled');
    expect(row.cancelledAt).not.toBeNull();
    expect(row.cancelledBy).toBe(admin.id);
    expect(row.cancelReason).toBe('Wrong GST rate — reissue');
  });

  it('refuses cancel when a payment is recorded', async () => {
    const id = await insertInvoice('paid');
    await db.insert(invoicePayments).values({
      companyId: admin.companyId!,
      invoiceId: id,
      paymentDate: '2026-06-02',
      amount: '50',
      mode: 'NEFT',
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    await expect(
      service.cancelInvoice(id, { reason: 'Customer paid, still want to cancel' }, admin),
    ).rejects.toBeInstanceOf(ConflictError);

    // Untouched — still live.
    const row = (await db.select().from(invoices).where(eq(invoices.id, id)))[0]!;
    expect(row.status).toBe('unpaid');
  });

  it('refuses a double-cancel', async () => {
    const id = await insertInvoice('double');
    await service.cancelInvoice(id, { reason: 'First cancel' }, admin);
    await expect(
      service.cancelInvoice(id, { reason: 'Second cancel' }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
