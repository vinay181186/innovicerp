// ADR-307 — §20.3 two-at-once test for the Party GRN against an Equipment SO.
//
// createPartyGrnForSo caps the receipt at the customer part's Pending, read
// under the SO row lock. Fixture (prefix TSOG-, self-contained, cleaned up):
// Equipment SO (2 sets) → BOM with ONE party_supplied line, Qty/Set 2 →
// child = a party_supplied_material `-RM` item → need 4.
// Plus a JWSO regression: the JWSO Party GRN path still saves.

import { randomUUID } from 'node:crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasters,
  clients,
  items,
  jobWorkOrderLines,
  jobWorkOrders,
  ncRegister,
  partyGrn,
  partyGrnLines,
  partyMaterials,
  partyStockLedger,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import * as service from './service';

const P = 'TSOG-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const SETS = 2;
const QTY_PER_SET = 2;
const NEED = SETS * QTY_PER_SET; // 4

let admin: AuthContext;
let companyId: string;
let clientId: string;
let soId: string;
let rmItemId: string;
let jwLineId: string;
let jwId: string;

async function teardown(): Promise<void> {
  const cli = await db
    .select({ id: clients.id })
    .from(clients)
    .where(like(clients.code, `${P}%`));
  const cliIds = cli.map((c) => c.id);
  if (cliIds.length > 0) {
    const pmIds = (
      await db
        .select({ id: partyMaterials.id })
        .from(partyMaterials)
        .where(inArray(partyMaterials.clientId, cliIds))
    ).map((p) => p.id);
    if (pmIds.length > 0) {
      // Append-only ledger: transaction-local maintenance switch (as service.test.ts).
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
        await tx.delete(partyStockLedger).where(inArray(partyStockLedger.partyMaterialId, pmIds));
      });
    }
    const grns = await db
      .select({ id: partyGrn.id, code: partyGrn.code })
      .from(partyGrn)
      .where(inArray(partyGrn.clientId, cliIds));
    if (grns.length > 0) {
      const grnIds = grns.map((g) => g.id);
      const lineIds = (
        await db
          .select({ id: partyGrnLines.id })
          .from(partyGrnLines)
          .where(inArray(partyGrnLines.partyGrnId, grnIds))
      ).map((l) => l.id);
      if (lineIds.length > 0) {
        await db.delete(ncRegister).where(inArray(ncRegister.partyGrnLineId, lineIds));
      }
      await db.delete(partyGrnLines).where(inArray(partyGrnLines.partyGrnId, grnIds));
      await db.delete(partyGrn).where(inArray(partyGrn.id, grnIds));
      await db.delete(activityLog).where(
        inArray(
          activityLog.refId,
          grns.map((g) => g.code),
        ),
      );
    }
    const jws = (
      await db
        .select({ id: jobWorkOrders.id })
        .from(jobWorkOrders)
        .where(like(jobWorkOrders.code, `${P}%`))
    ).map((j) => j.id);
    if (jws.length > 0) {
      await db.delete(jobWorkOrderLines).where(inArray(jobWorkOrderLines.jobWorkOrderId, jws));
      await db.delete(jobWorkOrders).where(inArray(jobWorkOrders.id, jws));
    }
    await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
    if (pmIds.length > 0) await db.delete(partyMaterials).where(inArray(partyMaterials.id, pmIds));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${P}%`));
  await db.delete(items).where(like(items.code, `${P}%`));
  if (cliIds.length > 0) await db.delete(clients).where(inArray(clients.id, cliIds));
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  companyId = u.companyId;
  await teardown();

  const by = { createdBy: u.id, updatedBy: u.id };
  clientId = (
    await db
      .insert(clients)
      .values({ companyId, code: `${P}CLI`, name: 'SO GRN concurrency client', ...by })
      .returning()
  )[0]!.id;

  const itemRows = await db
    .insert(items)
    .values([
      {
        companyId,
        code: `${P}EQUIP`,
        name: 'SO GRN equipment',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component' as const,
        ...by,
      },
      {
        companyId,
        code: `${P}PART-RM`,
        name: 'Customer part RM',
        revision: 'A',
        uom: 'NOS',
        itemType: 'party_supplied_material' as const,
        ...by,
      },
      {
        companyId,
        code: `${P}JWPART-RM`,
        name: 'JWSO customer RM',
        revision: 'A',
        uom: 'NOS',
        itemType: 'party_supplied_material' as const,
        ...by,
      },
    ])
    .returning();
  const parentId = itemRows.find((i) => i.code === `${P}EQUIP`)!.id;
  rmItemId = itemRows.find((i) => i.code === `${P}PART-RM`)!.id;
  const jwRmId = itemRows.find((i) => i.code === `${P}JWPART-RM`)!.id;

  // Register rows pre-made with a T-code so ensurePartyMaterial finds them.
  const pms = await db
    .insert(partyMaterials)
    .values([
      {
        companyId,
        code: `${P}PM-SO`,
        name: 'Customer part RM',
        uom: 'NOS',
        clientId,
        itemId: rmItemId,
        ...by,
      },
      {
        companyId,
        code: `${P}PM-JW`,
        name: 'JWSO customer RM',
        uom: 'NOS',
        clientId,
        itemId: jwRmId,
        ...by,
      },
    ])
    .returning();
  const pmJwId = pms.find((p) => p.code === `${P}PM-JW`)!.id;

  const bomId = (
    await db
      .insert(bomMasters)
      .values({
        companyId,
        bomNo: `${P}BOM`,
        bomName: 'SO GRN BOM',
        revision: 1,
        status: 'active',
        ...by,
      })
      .returning()
  )[0]!.id;
  await db.insert(bomMasterLines).values({
    companyId,
    bomMasterId: bomId,
    lineNo: 1,
    childItemId: rmItemId,
    qtyPerSet: String(QTY_PER_SET),
    bomType: 'party_supplied',
    ...by,
  });

  soId = (
    await db
      .insert(salesOrders)
      .values({
        companyId,
        code: `${P}SO-EQ`,
        soDate: '2026-11-17',
        customerName: 'SO GRN concurrency client',
        clientId,
        type: 'equipment',
        status: 'open',
        gstPercent: '18.00',
        bomMasterId: bomId,
        ...by,
      })
      .returning()
  )[0]!.id;
  await db.insert(salesOrderLines).values({
    companyId,
    salesOrderId: soId,
    lineNo: 1,
    itemId: parentId,
    partName: 'SO GRN equipment',
    uom: 'NOS',
    orderQty: SETS,
    rate: '1000',
    status: 'open',
    ...by,
  });

  // JWSO regression fixture (ADR-203 shape, as party-grn/service.test.ts).
  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${P}JW`,
        jwDate: '2026-11-17',
        clientId,
        customerName: 'SO GRN concurrency client',
        status: 'open',
        ...by,
      })
      .returning()
  )[0]!.id;
  jwLineId = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId: jwRmId,
        partyMaterialId: pmJwId,
        partName: `${P}JW-PART`,
        uom: 'NOS',
        orderQty: 10,
        status: 'open',
        ...by,
      })
      .returning()
  )[0]!.id;
});

afterAll(async () => {
  await teardown();
});

function soReceipt(qty: number) {
  return {
    grnDate: '2026-11-17',
    salesOrderId: soId,
    dcNo: `${P}DC-${randomUUID()}`,
    lines: [{ rmItemId, receivedQty: qty }],
  };
}

async function receivedOnSo(): Promise<number> {
  const r = (await db.execute(sql`
    SELECT COALESCE(SUM(l.received_qty), 0)::int AS q
      FROM public.party_grn_lines l
      JOIN public.party_grn g ON g.id = l.party_grn_id AND g.deleted_at IS NULL
     WHERE g.sales_order_id = ${soId}::uuid AND l.deleted_at IS NULL
  `)) as unknown as Array<{ q: number }>;
  return Number(r[0]!.q);
}

describe('Party GRN against Equipment SO — receive cap (ADR-307, §20.3)', () => {
  it('refuses a single receipt over the need (5 > 4)', async () => {
    await expect(service.createPartyGrn(soReceipt(NEED + 1), admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await receivedOnSo()).toBe(0);
  });

  it('two receipts of 3 at once: exactly one wins, Σ received never exceeds 4', async () => {
    const results = await Promise.allSettled([
      service.createPartyGrn(soReceipt(3), admin),
      service.createPartyGrn(soReceipt(3), admin),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason instanceof ValidationError || lost.reason instanceof ConflictError).toBe(
      true,
    );
    expect(String((lost.reason as Error).message)).toMatch(/pending/i);
    const total = await receivedOnSo();
    expect(total).toBe(3);
    expect(total).toBeLessThanOrEqual(NEED);
  });

  it('the remaining 1 can still be received, then nothing more', async () => {
    await service.createPartyGrn(soReceipt(1), admin);
    await expect(service.createPartyGrn(soReceipt(1), admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await receivedOnSo()).toBe(NEED);
  });
});

describe('Party GRN against JWSO — regression (ADR-203 path untouched)', () => {
  it('a JWSO Party GRN still saves against the JWSO line', async () => {
    const grn = await service.createPartyGrn(
      {
        grnDate: '2026-11-17',
        jobWorkOrderId: jwId,
        dcNo: `${P}DC-${randomUUID()}`,
        lines: [{ jwLineId, receivedQty: 5 }],
      },
      admin,
    );
    expect(grn.code).toMatch(/^PGRN-\d{5}$/);
    const d = await service.getPartyGrnDetail(grn.id, admin);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.receivedQty).toBe(5);
    const head = (
      await db
        .select({ so: partyGrn.salesOrderId, jw: partyGrn.jobWorkOrderId })
        .from(partyGrn)
        .where(eq(partyGrn.id, grn.id))
    )[0]!;
    expect(head.so).toBeNull();
    expect(head.jw).toBe(jwId);
  });
});
