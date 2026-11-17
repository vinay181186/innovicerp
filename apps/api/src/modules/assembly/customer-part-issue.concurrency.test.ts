// ADR-307 — §20.3 two-at-once test for Issue Customer Part → (Assembly Tracker).
//
// issueCustomerPartToAssembly caps the issue at In Store and at the need,
// read under the SO row lock; postPartyStockMove writes the zero-value party
// stock. Fixture (prefix TCPI-, self-contained, cleaned up): Equipment SO
// (2 sets) → BOM with ONE party_supplied line, Qty/Set 2 → need 4; 4 received
// and QC-accepted through the real services.

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
  ncRegister,
  partyGrn,
  partyGrnLines,
  partyMaterialIssues,
  partyMaterials,
  partyStockLedger,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { qcPartyGrn } from '../party-grn/qc';
import * as partyGrnService from '../party-grn/service';
import { issueCustomerPartToAssembly } from './customer-part-issue';

const P = 'TCPI-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const SETS = 2;
const QTY_PER_SET = 2;
const NEED = SETS * QTY_PER_SET; // 4

let admin: AuthContext;
let companyId: string;
let clientId: string;
let soId: string;
let rmItemId: string;
let pmId: string;

async function teardown(): Promise<void> {
  const cliIds = (
    await db
      .select({ id: clients.id })
      .from(clients)
      .where(like(clients.code, `${P}%`))
  ).map((c) => c.id);
  const soIds = (
    await db
      .select({ id: salesOrders.id })
      .from(salesOrders)
      .where(like(salesOrders.code, `${P}%`))
  ).map((s) => s.id);
  const pmIds =
    cliIds.length > 0
      ? (
          await db
            .select({ id: partyMaterials.id })
            .from(partyMaterials)
            .where(inArray(partyMaterials.clientId, cliIds))
        ).map((p) => p.id)
      : [];
  const refs: string[] = [];
  if (pmIds.length > 0) {
    // Append-only ledger: transaction-local maintenance switch (as party-grn/service.test.ts).
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
      await tx.delete(partyStockLedger).where(inArray(partyStockLedger.partyMaterialId, pmIds));
    });
  }
  if (soIds.length > 0) {
    const iss = await db
      .select({ id: partyMaterialIssues.id, code: partyMaterialIssues.code })
      .from(partyMaterialIssues)
      .where(inArray(partyMaterialIssues.salesOrderId, soIds));
    refs.push(...iss.map((i) => i.code));
    if (iss.length > 0) {
      await db.delete(partyMaterialIssues).where(
        inArray(
          partyMaterialIssues.id,
          iss.map((i) => i.id),
        ),
      );
    }
  }
  if (cliIds.length > 0) {
    const grns = await db
      .select({ id: partyGrn.id, code: partyGrn.code })
      .from(partyGrn)
      .where(inArray(partyGrn.clientId, cliIds));
    refs.push(...grns.map((g) => g.code));
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
    }
  }
  if (refs.length > 0) await db.delete(activityLog).where(inArray(activityLog.refId, refs));
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  if (pmIds.length > 0) await db.delete(partyMaterials).where(inArray(partyMaterials.id, pmIds));
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
      .values({ companyId, code: `${P}CLI`, name: 'Customer part issue client', ...by })
      .returning()
  )[0]!.id;

  const itemRows = await db
    .insert(items)
    .values([
      {
        companyId,
        code: `${P}EQUIP`,
        name: 'Customer part issue equipment',
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
    ])
    .returning();
  const parentId = itemRows.find((i) => i.code === `${P}EQUIP`)!.id;
  rmItemId = itemRows.find((i) => i.code === `${P}PART-RM`)!.id;

  // Register row pre-made with a T-code so ensurePartyMaterial finds it.
  pmId = (
    await db
      .insert(partyMaterials)
      .values({
        companyId,
        code: `${P}PM-SO`,
        name: 'Customer part RM',
        uom: 'NOS',
        clientId,
        itemId: rmItemId,
        ...by,
      })
      .returning()
  )[0]!.id;

  const bomId = (
    await db
      .insert(bomMasters)
      .values({
        companyId,
        bomNo: `${P}BOM`,
        bomName: 'Customer part issue BOM',
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
        customerName: 'Customer part issue client',
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
    partName: 'Customer part issue equipment',
    uom: 'NOS',
    orderQty: SETS,
    rate: '1000',
    status: 'open',
    ...by,
  });

  // Receive the full need and pass Incoming QC — through the real services.
  const grn = await partyGrnService.createPartyGrn(
    {
      grnDate: '2026-11-17',
      salesOrderId: soId,
      dcNo: `${P}DC-${randomUUID()}`,
      lines: [{ rmItemId, receivedQty: NEED }],
    },
    admin,
  );
  const d = await partyGrnService.getPartyGrnDetail(grn.id, admin);
  await qcPartyGrn(
    grn.id,
    { lines: [{ lineId: d.lines[0]!.id, acceptedQty: NEED, rejectedQty: 0 }] },
    admin,
  );
});

afterAll(async () => {
  await teardown();
});

async function issuedOnSo(): Promise<number> {
  const r = (await db.execute(sql`
    SELECT COALESCE(SUM(qty - returned_to_store_qty), 0)::int AS q
      FROM public.party_material_issues
     WHERE sales_order_id = ${soId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ q: number }>;
  return Number(r[0]!.q);
}

async function pmStockQty(): Promise<number> {
  const r = await db
    .select({ s: partyMaterials.stockQty })
    .from(partyMaterials)
    .where(eq(partyMaterials.id, pmId));
  return r[0]!.s;
}

const issue = (qty: number) =>
  issueCustomerPartToAssembly(soId, { issueDate: '2026-11-17', rmItemId, qty }, admin);

describe('Issue Customer Part to assembly — cap (ADR-307, §20.3)', () => {
  it('starts with the full need accepted into the customer store', async () => {
    expect(await pmStockQty()).toBe(NEED);
    expect(await issuedOnSo()).toBe(0);
  });

  it('two issues of 3 at once: exactly one wins, Σ issued never exceeds 4', async () => {
    const results = await Promise.allSettled([issue(3), issue(3)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);

    const issued = await issuedOnSo();
    expect(issued).toBe(3);
    expect(issued).toBeLessThanOrEqual(NEED);
    const stock = await pmStockQty();
    expect(stock).toBe(NEED - 3);
    expect(stock).toBeGreaterThanOrEqual(0);
  });

  it('refuses an issue over what is left in store (2 > 1)', async () => {
    await expect(issue(2)).rejects.toBeInstanceOf(ConflictError);
    expect(await issuedOnSo()).toBe(3);
    expect(await pmStockQty()).toBe(1);
  });

  it('every ledger row of the SO receipt and issue carries the sales_order_id', async () => {
    const rows = await db
      .select({
        so: partyStockLedger.salesOrderId,
        movement: partyStockLedger.movement,
        direction: partyStockLedger.direction,
        qty: partyStockLedger.qty,
      })
      .from(partyStockLedger)
      .where(eq(partyStockLedger.partyMaterialId, pmId));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.so).toBe(soId);
    const outQty = rows.filter((r) => r.direction === 'out').reduce((a, r) => a + r.qty, 0);
    const inQty = rows.filter((r) => r.direction === 'in').reduce((a, r) => a + r.qty, 0);
    expect(outQty).toBe(3);
    expect(inQty).toBe(NEED);
    expect(inQty - outQty).toBe(await pmStockQty());
  });
});
