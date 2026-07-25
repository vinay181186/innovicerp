// Party Material Issue guard tests (ADR-079). Fixtures inserted directly so the
// availability guard (issue qty <= party stock) is exercised deterministically.

import { and, asc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, jobWorkOrders, partyMaterialIssues, partyMaterials, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
let clientId: string;
const createdIssueIds: string[] = [];
let pmId: string;
let jwId: string;

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
  clientId = c.id;

  pmId = (
    await db
      .insert(partyMaterials)
      .values({
        companyId: admin.companyId!,
        code: `PM-80741${String(Date.now()).slice(-4)}`,
        name: 'T074 Issue Guard Material',
        uom: 'NOS',
        clientId,
        stockQty: 0,
        receivedQty: 0,
        issuedQty: 0,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: partyMaterials.id })
  )[0]!.id;

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId: admin.companyId!,
        code: `T074I-JW-${Date.now()}`,
        jwDate: '2026-05-02',
        clientId,
        customerName: 'T074 Client',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: jobWorkOrders.id })
  )[0]!.id;
});

afterAll(async () => {
  for (const id of createdIssueIds) {
    await db.delete(partyMaterialIssues).where(eq(partyMaterialIssues.id, id));
  }
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(partyMaterials).where(eq(partyMaterials.id, pmId));
});

describe('party-material-issues service', () => {
  it('rejects an issue that exceeds party stock on hand', async () => {
    await expect(
      service.createPartyMaterialIssue(
        { issueDate: '2026-05-02', jobWorkOrderId: jwId, partyMaterialId: pmId, qty: 5 },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('issues within stock and draws down party_materials (stock↓, issued↑)', async () => {
    await db
      .update(partyMaterials)
      .set({ stockQty: 10, receivedQty: 10 })
      .where(eq(partyMaterials.id, pmId));

    const issue = await service.createPartyMaterialIssue(
      { issueDate: '2026-05-02', jobWorkOrderId: jwId, partyMaterialId: pmId, qty: 10 },
      admin,
    );
    createdIssueIds.push(issue.id);
    expect(issue.qty).toBe(10);

    const pm = (await db.select().from(partyMaterials).where(eq(partyMaterials.id, pmId)))[0]!;
    expect(pm.stockQty).toBe(0);
    expect(pm.issuedQty).toBe(10);
  });
});
