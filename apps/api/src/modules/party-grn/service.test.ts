// Party GRN service tests — the ADR-102 guards + the cancel path.
//
// Fixtures are self-contained and prefixed TPG- so they never touch seed or
// production rows: one client, one JWSO with TWO lines carrying DIFFERENT
// items, and one party material per item. That shape is what makes the
// wrong-part case testable — it is exactly the shape that produced the live
// bug (a LEVER received against the SINGLE FIRE CHECK LEVER line).

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
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
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
/** Party material for line 2's item — used for the wrong-part case. */
let pmBId: string;

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

  // Two DISTINCT seed items — the wrong-part guard compares their ids.
  const itemRows = await db
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')))
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

  await db.insert(jobWorkOrderLines).values([
    {
      companyId,
      jobWorkOrderId: jwId,
      lineNo: 1,
      itemId: itemAId,
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
      partName: `${TEST_PREFIX}PART-B`,
      uom: 'NOS',
      orderQty: ORDER_QTY,
      status: 'open',
      createdBy: u.id,
      updatedBy: u.id,
    },
  ]);

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
});

afterAll(async () => {
  const grnIds = (
    await db.select({ id: partyGrn.id }).from(partyGrn).where(eq(partyGrn.jobWorkOrderId, jwId))
  ).map((g) => g.id);
  if (grnIds.length > 0) {
    await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
    await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
  }
  await db.delete(activityLog).where(like(activityLog.refId, 'PGRN-%'));
  await db.delete(partyMaterials).where(like(partyMaterials.code, `${TEST_PREFIX}%`));
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
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

describe('party-grn service — ADR-102 guards', () => {
  it('rejects a line with no JWSO line number', async () => {
    await expect(
      service.createPartyGrn(
        {
          grnDate: '2026-08-04',
          jobWorkOrderId: jwId,
          // Cast: the zod schema now makes this required, so the only way to
          // reach the service guard is to bypass the schema — which is exactly
          // what a stale client or a direct API caller would do.
          lines: [{ partyMaterialId: pmAId, receivedQty: 1 } as never],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a JWSO line number that does not exist on the order', async () => {
    await expect(
      service.createPartyGrn(
        {
          grnDate: '2026-08-04',
          jobWorkOrderId: jwId,
          lines: [{ partyMaterialId: pmAId, receivedQty: 1, jwLineNoText: '99' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a material that is not that line’s part', async () => {
    // PM-B belongs to item B (line 2) — receiving it against line 1 is the
    // live bug this guard exists for.
    await expect(
      service.createPartyGrn(
        {
          grnDate: '2026-08-04',
          jobWorkOrderId: jwId,
          lines: [{ partyMaterialId: pmBId, receivedQty: 1, jwLineNoText: '1' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than the line’s order qty in a single receipt', async () => {
    await expect(
      service.createPartyGrn(
        {
          grnDate: '2026-08-04',
          jobWorkOrderId: jwId,
          lines: [{ partyMaterialId: pmAId, receivedQty: ORDER_QTY + 1, jwLineNoText: '1' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a correct receipt and adds the qty to party stock', async () => {
    const before = await pmStock(pmAId);
    const grn = await service.createPartyGrn(
      {
        grnDate: '2026-08-04',
        jobWorkOrderId: jwId,
        lines: [{ partyMaterialId: pmAId, receivedQty: 60, jwLineNoText: '1' }],
      },
      admin,
    );
    expect(grn.code).toMatch(/^PGRN-\d{5}$/);
    const after = await pmStock(pmAId);
    expect(after.stockQty).toBe(before.stockQty + 60);
    expect(after.receivedQty).toBe(before.receivedQty + 60);
  });

  it('blocks a second receipt that would push the line past its order qty', async () => {
    // 60 already received above; 100 more would be 160 against an order of 100.
    await expect(
      service.createPartyGrn(
        {
          grnDate: '2026-08-04',
          jobWorkOrderId: jwId,
          lines: [{ partyMaterialId: pmAId, receivedQty: ORDER_QTY, jwLineNoText: '1' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('caps each JWSO line separately — line 2 is still fully open', async () => {
    const grn = await service.createPartyGrn(
      {
        grnDate: '2026-08-04',
        jobWorkOrderId: jwId,
        lines: [{ partyMaterialId: pmBId, receivedQty: ORDER_QTY, jwLineNoText: '2' }],
      },
      admin,
    );
    expect(grn.id).toBeTruthy();
  });
});

describe('party-grn service — cancel (ADR-102)', () => {
  it('reverses the qty off party stock and soft-deletes the GRN', async () => {
    const created = await service.createPartyGrn(
      {
        grnDate: '2026-08-04',
        jobWorkOrderId: jwId,
        lines: [{ partyMaterialId: pmAId, receivedQty: 10, jwLineNoText: '1' }],
      },
      admin,
    );
    const afterCreate = await pmStock(pmAId);

    const res = await service.cancelPartyGrn(created.id, 'entered twice', admin);
    expect(res.reversedQty).toBe(10);

    const afterCancel = await pmStock(pmAId);
    expect(afterCancel.stockQty).toBe(afterCreate.stockQty - 10);
    expect(afterCancel.receivedQty).toBe(afterCreate.receivedQty - 10);

    // Gone from reads, and its qty no longer counts toward the line cap.
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

  it('requires a reason', async () => {
    const created = await service.createPartyGrn(
      {
        grnDate: '2026-08-04',
        jobWorkOrderId: jwId,
        lines: [{ partyMaterialId: pmAId, receivedQty: 1, jwLineNoText: '1' }],
      },
      admin,
    );
    await expect(service.cancelPartyGrn(created.id, '   ', admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await service.cancelPartyGrn(created.id, 'cleanup', admin);
  });

  it('refuses when the material has already been issued out', async () => {
    const created = await service.createPartyGrn(
      {
        grnDate: '2026-08-04',
        jobWorkOrderId: jwId,
        lines: [{ partyMaterialId: pmAId, receivedQty: 5, jwLineNoText: '1' }],
      },
      admin,
    );
    // Simulate an issue to production: stock drops, received stays.
    await db
      .update(partyMaterials)
      .set({ stockQty: 0, issuedQty: 999 })
      .where(eq(partyMaterials.id, pmAId));

    await expect(service.cancelPartyGrn(created.id, 'oops', admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(
      service.cancelPartyGrn('00000000-0000-0000-0000-000000000000', 'x', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
