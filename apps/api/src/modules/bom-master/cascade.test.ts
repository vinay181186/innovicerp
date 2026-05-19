// BOM cascade tests (BOM-8). Verifies cascadeBomToSoLine spawns the
// right child entities per bom_type + is idempotent on re-run.

import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  bomMasters,
  items,
  jobCards,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { withUserContext } from '../../db/with-user-context';
import { cascadeBomToSoLine } from './cascade';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TBOMC-';

let admin: AuthContext;
let itemA: string;
let itemB: string;
let itemC: string;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const it = await db
    .insert(items)
    .values([
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}A`,
        name: 'Cascade A',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}B`,
        name: 'Cascade B',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}C`,
        name: 'Cascade C',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  itemA = it[0]!.id;
  itemB = it[1]!.id;
  itemC = it[2]!.id;
});

afterAll(async () => {
  // SO cascade-deletes its lines via FK. Child JCs / PRs reference
  // source_so_line_id; wipe them by code prefix first.
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `PR-BOM-%`));
  await db.delete(jobCards).where(like(jobCards.code, `JC-BOM-%`));
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('BOM-8 cascadeBomToSoLine', () => {
  it('spawns child JC for manufacture line + PR for purchase line', async () => {
    // Create a BOM with one of each type.
    const bom = await service.createBomMaster(
      {
        bomNo: `${TEST_PREFIX}BOM-A`,
        bomName: 'mixed types',
        status: 'active',
        lines: [
          { childItemId: itemA, qtyPerSet: 2, bomType: 'manufacture' },
          { childItemId: itemB, qtyPerSet: 3, bomType: 'purchase' },
          { childItemId: itemC, qtyPerSet: 1, bomType: 'outsource' },
        ],
      },
      admin,
    );

    // Plant an SO + line referencing the BOM (manually, bypassing the
    // sales-orders service so we can isolate the cascade behaviour).
    const so = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-A`,
        soDate: '2026-05-20',
        status: 'open',
        type: 'component_manufacturing',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const soLine = await db
      .insert(salesOrderLines)
      .values({
        companyId: admin.companyId!,
        salesOrderId: so[0]!.id,
        lineNo: 1,
        itemId: itemA,
        partName: 'Parent assembly',
        orderQty: 5,
        rate: '0',
        status: 'open',
        sourceBomMasterId: bom.id,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();

    // Run the cascade.
    const result = await withUserContext(admin, async (tx) => {
      return cascadeBomToSoLine(tx, soLine[0]!.id, admin);
    });
    expect(result.fired).toBe(true);
    expect(result.createdJobCardCodes).toHaveLength(1);
    expect(result.createdPrCodes).toHaveLength(2); // purchase + outsource both → PR

    // Verify the spawned JC qty = soLineQty (5) × bomLineQtyPerSet (2) = 10
    const jcs = await db.select().from(jobCards).where(eq(jobCards.sourceSoLineId, soLine[0]!.id));
    expect(jcs).toHaveLength(1);
    expect(jcs[0]!.orderQty).toBe(10);
    expect(jcs[0]!.itemId).toBe(itemA);

    // Verify the PRs — one for purchase (B), one for outsource (C) with
    // operation = 'OUTSOURCE'
    const prs = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.sourceSoLineId, soLine[0]!.id));
    expect(prs).toHaveLength(2);
    const purchasePr = prs.find((p) => p.itemId === itemB);
    const outsourcePr = prs.find((p) => p.itemId === itemC);
    expect(purchasePr).toBeDefined();
    expect(outsourcePr).toBeDefined();
    expect(purchasePr!.qty).toBe(15); // 5 × 3
    expect(outsourcePr!.qty).toBe(5); // 5 × 1
    expect(purchasePr!.operation).toBeNull();
    expect(outsourcePr!.operation).toBe('OUTSOURCE');
  });

  it('is idempotent — second call returns fired:false and creates nothing new', async () => {
    // Use the same fixture from previous test by finding the SO line.
    const soLines = await db
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .where(eq(salesOrders.code, `${TEST_PREFIX}SO-A`))
      .limit(1);
    const soLineId = soLines[0]!.id;

    const result = await withUserContext(admin, async (tx) => {
      return cascadeBomToSoLine(tx, soLineId, admin);
    });
    expect(result.fired).toBe(false);
    expect(result.createdJobCardCodes).toHaveLength(0);
    expect(result.createdPrCodes).toHaveLength(0);

    // Total child counts unchanged from previous test.
    const jcs = await db.select().from(jobCards).where(eq(jobCards.sourceSoLineId, soLineId));
    expect(jcs).toHaveLength(1);
    const prs = await db
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.sourceSoLineId, soLineId));
    expect(prs).toHaveLength(2);
  });

  it('returns fired:false when SO line has no sourceBomMasterId', async () => {
    const so = await db
      .insert(salesOrders)
      .values({
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}SO-NO-BOM`,
        soDate: '2026-05-20',
        status: 'open',
        type: 'component_manufacturing',
        gstPercent: '18.00',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    const soLine = await db
      .insert(salesOrderLines)
      .values({
        companyId: admin.companyId!,
        salesOrderId: so[0]!.id,
        lineNo: 1,
        itemId: itemA,
        partName: 'Plain part',
        orderQty: 5,
        rate: '0',
        status: 'open',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();

    const result = await withUserContext(admin, async (tx) => {
      return cascadeBomToSoLine(tx, soLine[0]!.id, admin);
    });
    expect(result.fired).toBe(false);
  });
});
