import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, purchaseRequests, users, vendors } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { purchaseRequestsRoutes } from './routes';

const TEST_PREFIX = 'T036AR-';
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
  await app.register(purchaseRequestsRoutes);
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
      and(
        eq(items.companyId, u.companyId),
        isNull(items.deletedAt),
        notLike(items.code, 'T%-%'),
      ),
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
  await db.delete(purchaseRequests).where(like(purchaseRequests.code, `${TEST_PREFIX}%`));
});

describe('purchase-requests routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /purchase-requests returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/purchase-requests' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /purchase-requests returns 200 with auth and lists items', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/purchase-requests?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /purchase-requests returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-requests',
      headers: { 'content-type': 'application/json' },
      payload: {
        code,
        prDate: '2026-05-02',
        vendorId: firstVendorId,
        itemId: firstItemId,
        qty: 5,
        estCost: 0,
        status: 'open',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.qty).toBe(5);
  });

  it('POST /purchase-requests returns 400 when both vendor refs missing', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-requests',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}BAD`,
        prDate: '2026-05-02',
        itemId: firstItemId,
        qty: 1,
        estCost: 0,
        status: 'open',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /purchase-requests returns clean 403 for viewer role (not 500 from RLS leak)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/purchase-requests',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}V`,
        prDate: '2026-05-02',
        vendorId: firstVendorId,
        itemId: firstItemId,
        qty: 1,
        estCost: 0,
        status: 'open',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
