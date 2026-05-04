import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import {
  items,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  users,
  vendors,
} from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { purchaseOrdersRoutes } from './routes';

const TEST_PREFIX = 'T036BR-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstVendorId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(purchaseOrdersRoutes);
  return app;
}

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
  const itemRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  firstItemId = itemRow[0]!.id;
  const vendorRow = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        eq(vendors.companyId, u.companyId),
        isNull(vendors.deletedAt),
        notLike(vendors.code, 'T%-%'),
      ),
    )
    .orderBy(asc(vendors.createdAt))
    .limit(1);
  firstVendorId = vendorRow[0]!.id;
});

afterAll(async () => {
  const testHeaders = await db
    .select({ id: purchaseOrders.id })
    .from(purchaseOrders)
    .where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      await db
        .update(purchaseRequests)
        .set({ poId: null, status: 'open' })
        .where(eq(purchaseRequests.poId, id));
    }
    await db.delete(purchaseOrders).where(like(purchaseOrders.code, `${TEST_PREFIX}%`));
  }
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `${TEST_PREFIX}%`));
});

describe('purchase-orders routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /purchase-orders returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/purchase-orders' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /purchase-orders returns 200 with auth', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/purchase-orders?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
  });

  it('POST /purchase-orders returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'Routed', qty: 5, rate: 0 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe(code);
  });

  it('POST /purchase-orders returns 400 when both vendor refs missing', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}BAD`,
          poDate: '2026-05-03',
          poType: 'standard',
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'X', qty: 1, rate: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /purchase-orders returns 400 with no lines', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}NL`,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /purchase-orders/from-pr converts PR + returns PO 201', async () => {
    const prCode = `${TEST_PREFIX}FPR`;
    const prRow = await db
      .insert(purchaseRequests)
      .values({
        companyId: admin.companyId!,
        code: prCode,
        prDate: '2026-05-03',
        status: 'open',
        vendorId: firstVendorId,
        itemId: firstItemId,
        itemName: 'Source',
        qty: 7,
        estCost: '5',
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning();
    app = await buildApp(admin);
    const poCode = `${TEST_PREFIX}FPR-PO`;
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders/from-pr',
      headers: { 'content-type': 'application/json' },
      payload: {
        prId: prRow[0]!.id,
        header: {
          code: poCode,
          poDate: '2026-05-03',
          poType: 'job_work',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(poCode);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].qty).toBe(7);
  });

  it('POST /purchase-orders returns clean 403 for viewer role (not 500 from RLS leak)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}V`,
          poDate: '2026-05-03',
          poType: 'standard',
          vendorId: firstVendorId,
          status: 'draft',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        lines: [{ itemId: firstItemId, itemName: 'X', qty: 1, rate: 0 }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
