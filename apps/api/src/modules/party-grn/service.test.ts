// Party GRN service tests — ADR-203 gate-in, Incoming QC and cancel.
//
// Fixtures are self-contained and prefixed TPG- so they never touch seed or
// production rows: one client, one JWSO with TWO lines carrying DIFFERENT
// items, each line pointing at its own party material (the line's customer RM).

import { and, asc, eq, inArray, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  clients,
  items,
  jobWorkOrderLines,
  jobWorkOrders,
  partyGrn,
  partyGrnLines,
  partyMaterials,
  partyStockLedger,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { qcPartyGrn } from './qc';
import * as service from './service';

const TEST_PREFIX = 'TPG-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let clientId: string;
let jwId: string;
let itemAId: string;
let itemBId: string;
/** Party material for line 1's item. */
let pmAId: string;
/** Party material for line 2's item. */
let pmBId: string;
let line1Id: string;
let line2Id: string;

const ORDER_QTY = 100;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  const companyId = u.companyId;

  // Two DISTINCT seed items, one per JWSO line.
  const itemRows = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(
      and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(2);
  if (itemRows.length < 2) throw new Error('Need 2 items in the seed company');
  itemAId = itemRows[0]!.id;
  itemBId = itemRows[1]!.id;

  clientId = (
    await db
      .insert(clients)
      .values({
        companyId,
        code: `${TEST_PREFIX}CLI`,
        name: 'Party GRN test client',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;

  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${TEST_PREFIX}JW`,
        jwDate: '2026-08-04',
        clientId,
        customerName: 'Party GRN test client',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;

  // ADR-203: each JWSO line carries its own customer material.
  const pms = await db
    .insert(partyMaterials)
    .values([
      {
        companyId,
        code: `${TEST_PREFIX}PM-A`,
        name: 'Test party material A',
        uom: 'NOS',
        clientId,
        itemId: itemAId,
        createdBy: u.id,
        updatedBy: u.id,
      },
      {
        companyId,
        code: `${TEST_PREFIX}PM-B`,
        name: 'Test party material B',
        uom: 'NOS',
        clientId,
        itemId: itemBId,
        createdBy: u.id,
        updatedBy: u.id,
      },
    ])
    .returning();
  pmAId = pms.find((p) => p.code === `${TEST_PREFIX}PM-A`)!.id;
  pmBId = pms.find((p) => p.code === `${TEST_PREFIX}PM-B`)!.id;

  const lines = await db
    .insert(jobWorkOrderLines)
    .values([
      {
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId: itemAId,
        partyMaterialId: pmAId,
        partName: `${TEST_PREFIX}PART-A`,
        uom: 'NOS',
        orderQty: ORDER_QTY,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      },
      {
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 2,
        itemId: itemBId,
        partyMaterialId: pmBId,
        partName: `${TEST_PREFIX}PART-B`,
        uom: 'NOS',
        orderQty: ORDER_QTY,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      },
    ])
    .returning();
  line1Id = lines.find((l) => l.lineNo === 1)!.id;
  line2Id = lines.find((l) => l.lineNo === 2)!.id;
});

afterAll(async () => {
  const grnIds = (
    await db.select({ id: partyGrn.id }).from(partyGrn).where(eq(partyGrn.jobWorkOrderId, jwId))
  ).map((g) => g.id);
  await db
    .delete(partyStockLedger)
    .where(inArray(partyStockLedger.partyMaterialId, [pmAId, pmBId]));
  if (grnIds.length > 0) {
    await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
    await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
  }
  await db.delete(activityLog).where(like(activityLog.refId, 'PGRN-%'));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
  await db.delete(partyMaterials).where(like(partyMaterials.code, `${TEST_PREFIX}%`));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

/** Current stock/received on a party material. */
async function pmStock(id: string): Promise<{ stockQty: number; receivedQty: number }> {
  const r = (
    await db
      .select({ stockQty: partyMaterials.stockQty, receivedQty: partyMaterials.receivedQty })
      .from(partyMaterials)
      .where(eq(partyMaterials.id, id))
  )[0]!;
  return r;
}

function receipt(jwLineId: string, receivedQty: number) {
  return { grnDate: '2026-08-04', jobWorkOrderId: jwId, lines: [{ jwLineId, receivedQty }] };
}

/** Receive, then pass Incoming QC with everything accepted. */
async function receiveAndAccept(jwLineId: string, qty: number) {
  const grn = await service.createPartyGrn(receipt(jwLineId, qty), admin);
  const detail = await service.getPartyGrnDetail(grn.id, admin);
  await qcPartyGrn(
    grn.id,
    { lines: [{ lineId: detail.lines[0]!.id, acceptedQty: qty, rejectedQty: 0 }] },
    admin,
  );
  return grn;
}

describe('party-grn service — create (ADR-203)', () => {
  it('rejects an unknown JWSO line', async () => {
    await expect(
      service.createPartyGrn(receipt('00000000-0000-0000-0000-000000000000', 1), admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects more than the line order qty in a single receipt', async () => {
    await expect(
      service.createPartyGrn(receipt(line1Id, ORDER_QTY + 1), admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('books the gate-in only — nothing enters the register until QC', async () => {
    const before = await pmStock(pmAId);
    const grn = await service.createPartyGrn(receipt(line1Id, 60), admin);
    expect(grn.code).toMatch(/^PGRN-\d{5}$/);
    const detail = await service.getPartyGrnDetail(grn.id, admin);
    expect(detail.qcPendingLines).toBe(1);
    expect(detail.totalAcceptedQty).toBe(0);
    expect(detail.lines[0]!.partyMaterialId).toBe(pmAId);
    expect(detail.lines[0]!.jwLineNoText).toBe('1');
    expect(await pmStock(pmAId)).toEqual(before);
  });

  it('counts pieces waiting for QC against the order qty', async () => {
    // 60 waiting above; 41 more would be 101 against an order of 100.
    await expect(service.createPartyGrn(receipt(line1Id, 41), admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('party-grn service — Incoming QC (ADR-203)', () => {
  it('refuses a split that does not add up to received', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 10), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    await expect(
      qcPartyGrn(
        grn.id,
        { lines: [{ lineId: d.lines[0]!.id, acceptedQty: 5, rejectedQty: 0 }] },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await service.cancelPartyGrn(grn.id, 'cleanup', admin);
  });

  it('posts only the accepted qty and holds the rejects', async () => {
    const before = await pmStock(pmBId);
    const grn = await service.createPartyGrn(receipt(line2Id, 10), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const after = await qcPartyGrn(
      grn.id,
      {
        lines: [{ lineId: d.lines[0]!.id, acceptedQty: 7, rejectedQty: 3, rejectReason: 'rusty' }],
      },
      admin,
    );
    expect(after.qcPendingLines).toBe(0);
    expect(after.totalAcceptedQty).toBe(7);
    const s = await pmStock(pmBId);
    expect(s.stockQty).toBe(before.stockQty + 7);
    expect(s.receivedQty).toBe(before.receivedQty + 7);
  });

  it('lets exactly one of two simultaneous QCs of one line through', async () => {
    const grn = await service.createPartyGrn(receipt(line2Id, 4), admin);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    const body = { lines: [{ lineId: d.lines[0]!.id, acceptedQty: 4, rejectedQty: 0 }] };
    const results = await Promise.allSettled([
      qcPartyGrn(grn.id, body, admin),
      qcPartyGrn(grn.id, body, admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });
});

describe('party-grn service — cancel (ADR-203)', () => {
  it('reverses the accepted qty and soft-deletes the GRN', async () => {
    const created = await receiveAndAccept(line1Id, 10);
    const afterQc = await pmStock(pmAId);

    const res = await service.cancelPartyGrn(created.id, 'entered twice', admin);
    expect(res.reversedQty).toBe(10);

    const afterCancel = await pmStock(pmAId);
    expect(afterCancel.stockQty).toBe(afterQc.stockQty - 10);
    expect(afterCancel.receivedQty).toBe(afterQc.receivedQty - 10);

    await expect(service.getPartyGrnDetail(created.id, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const rows = await db
      .select({ deletedAt: partyGrn.deletedAt, remarks: partyGrn.remarks })
      .from(partyGrn)
      .where(eq(partyGrn.id, created.id));
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(rows[0]!.remarks).toContain('[Cancelled] entered twice');
  });

  it('requires a reason, and refuses a second cancel', async () => {
    const created = await service.createPartyGrn(receipt(line1Id, 1), admin);
    await expect(service.cancelPartyGrn(created.id, '   ', admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await service.cancelPartyGrn(created.id, 'cleanup', admin);
    await expect(service.cancelPartyGrn(created.id, 'again', admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      service.cancelPartyGrn('00000000-0000-0000-0000-000000000000', 'x', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
