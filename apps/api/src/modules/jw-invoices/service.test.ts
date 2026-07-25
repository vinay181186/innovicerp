// JW Invoice guard + labour-math tests (ADR-079). Bills qty x rate + GST, capped
// at returned − invoiced. Fixtures inserted directly (line pre-set returned=5).

import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, jobWorkOrderLines, jobWorkOrders, jwInvoices, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
let jwId: string;
let jwLineId: string;
const createdInvoiceIds: string[] = [];

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

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId: admin.companyId!,
        code: `T074V-JW-${Date.now()}`,
        jwDate: '2026-05-02',
        clientId: c.id,
        customerName: 'T074 Client',
        status: 'open',
        gstPercent: '18',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrders.id })
  )[0]!.id;
  jwLineId = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId: admin.companyId!,
        jobWorkOrderId: jwId,
        lineNo: 1,
        partName: 'T074 Part',
        orderQty: 10,
        rate: '45',
        uom: 'NOS',
        status: 'open',
        returnedQty: 5,
        invoicedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrderLines.id })
  )[0]!.id;
});

afterAll(async () => {
  for (const id of createdInvoiceIds) await db.delete(jwInvoices).where(eq(jwInvoices.id, id));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, jwLineId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
});

describe('jw-invoices service', () => {
  it('rejects invoicing more than has been returned', async () => {
    await expect(
      service.createJwInvoice(
        { invoiceDate: '2026-05-02', jobWorkOrderLineId: jwLineId, qty: 6 },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('bills labour = qty x rate + GST and bumps invoiced_qty', async () => {
    const inv = await service.createJwInvoice(
      { invoiceDate: '2026-05-02', jobWorkOrderLineId: jwLineId, qty: 5 },
      admin,
    );
    createdInvoiceIds.push(inv.id);
    expect(inv.taxableAmount).toBe(225); // 5 x 45
    expect(inv.gstAmount).toBe(40.5); // 18%
    expect(inv.totalAmount).toBe(265.5);

    const line = (
      await db.select().from(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, jwLineId))
    )[0]!;
    expect(line.invoicedQty).toBe(5);
  });
});
