// JW Return Challan guard test (ADR-079). A JW line with no completed Job Card
// has produced = 0, so any return must be rejected (can't return what wasn't
// machined). Fixtures inserted directly.

import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, jobWorkOrderLines, jobWorkOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
let jwId: string;
let jwLineId: string;

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
        code: `T074R-JW-${Date.now()}`,
        jwDate: '2026-05-02',
        clientId: c.id,
        customerName: 'T074 Client',
        status: 'open',
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
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrderLines.id })
  )[0]!.id;
});

afterAll(async () => {
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.id, jwLineId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
});

describe('jw-returns service', () => {
  it('rejects a return with nothing produced (no completed Job Card)', async () => {
    await expect(
      service.createJwReturnChallan(
        { returnDate: '2026-05-02', jobWorkOrderLineId: jwLineId, qty: 1 },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
