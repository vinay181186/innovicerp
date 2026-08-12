// Assembly routes tests (PL-5). Auth + zod-param validation + happy paths.

import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  activityLog,
  bomMasterLines,
  bomMasters,
  itemStockBalances,
  items,
  salesOrderLines,
  salesOrders,
  storeTransactions,
  users,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { assemblyRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TPL5R-';
let admin: AuthContext;
let soId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(assemblyRoutes);
  return app;
}

async function teardown(): Promise<void> {
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  // Assembling debits components into the ledger (ADR-115); those rows hold an
  // item_id FK, so they must go before the items themselves.
  await db.delete(storeTransactions).where(like(storeTransactions.sourceRef, `%${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  // The SO must be genuinely buildable, not just present: markUnitAssembled
  // caps the batch at what stock allows (ADR-116), so a bare Equipment SO with
  // no BOM and no lines correctly 409s. Give it a BOM with one well-stocked
  // component and an order line, so the POST exercises the real happy path.
  const itemRows = await db
    .insert(items)
    .values([
      {
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}EQUIP`,
        name: 'Routes Equipment',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: admin.companyId!,
        code: `${TEST_PREFIX}CHILD`,
        name: 'Routes Child',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  const parentItemId = itemRows[0]!.id;
  const childItemId = itemRows[1]!.id;

  await db.insert(itemStockBalances).values({
    companyId: admin.companyId!,
    itemId: childItemId,
    onHandQty: 20,
  });

  const bom = await db
    .insert(bomMasters)
    .values({
      companyId: admin.companyId!,
      bomNo: `${TEST_PREFIX}BOM`,
      bomName: 'Routes BOM',
      revision: 1,
      status: 'active',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const bomId = bom[0]!.id;

  await db.insert(bomMasterLines).values({
    companyId: admin.companyId!,
    bomMasterId: bomId,
    lineNo: 1,
    childItemId,
    qtyPerSet: '1',
    bomType: 'purchase',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  const so = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-EQ`,
      soDate: '2026-05-21',
      customerName: 'Routes',
      type: 'equipment',
      status: 'open',
      gstPercent: '18.00',
      bomMasterId: bomId,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soId = so[0]!.id;

  await db.insert(salesOrderLines).values({
    companyId: admin.companyId!,
    salesOrderId: soId,
    lineNo: 1,
    itemId: parentItemId,
    partName: 'Routes Equipment',
    uom: 'NOS',
    orderQty: 2,
    rate: '10000',
    status: 'open',
    createdBy: admin.id,
    updatedBy: admin.id,
  });
});

afterAll(async () => {
  await teardown();
});

describe('assembly routes', () => {
  let app: FastifyInstance;

  it('GET /assemblies returns 401 without auth', async () => {
    app = await buildApp(null);
    try {
      const res = await app.inject({ method: 'GET', url: '/assemblies' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /assemblies returns 200 + items array for admin', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/assemblies' });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().items)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('GET /assemblies/:soId returns the tracker envelope', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: `/assemblies/${soId}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.header.soId).toBe(soId);
      expect(body).toHaveProperty('components');
      expect(body).toHaveProperty('rollup');
      expect(body).toHaveProperty('units');
    } finally {
      await app.close();
    }
  });

  it('GET /assemblies/:soId returns 404 on unknown id', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/assemblies/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET /assemblies/:soId returns 400 on malformed uuid', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/assemblies/not-a-uuid' });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('POST /assemblies/:soId/units inserts a unit and returns 201', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/assemblies/${soId}/units`,
        payload: { serialNo: 'SN-RT-1' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().serialNo).toBe('SN-RT-1');
    } finally {
      await app.close();
    }
  });

  it('POST /assemblies/:soId/units returns 409 when the batch exceeds what is buildable', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/assemblies/${soId}/units`,
        payload: { qty: 99 },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});
