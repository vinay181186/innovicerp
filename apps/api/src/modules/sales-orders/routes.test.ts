import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, salesOrderLines, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { salesOrdersRoutes } from './routes';

const TEST_PREFIX = 'T030R-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(salesOrdersRoutes);
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
    .where(eq(items.companyId, u.companyId))
    .limit(1);
  const it = itemRow[0];
  if (!it) throw new Error('No items in seed company — run migration load first');
  firstItemId = it.id;
});

afterAll(async () => {
  const testHeaders = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    }
    await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
  }
});

describe('sales-orders routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /sales-orders returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/sales-orders' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /sales-orders returns 200 with auth and lists items', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/sales-orders?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /sales-orders returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/sales-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code,
          soDate: '2026-05-02',
          customerName: 'Routes Customer',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [
          { partName: 'Routed Part', itemId: firstItemId, uom: 'NOS', orderQty: 5, rate: 0 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.lines).toHaveLength(1);
  });

  it('POST /sales-orders returns 400 on Zod validation failure (no client info)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/sales-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: { code: `${TEST_PREFIX}BAD`, soDate: '2026-05-02', type: 'component_manufacturing', status: 'open', gstPercent: 18 },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /sales-orders returns clean 403 for viewer role (not 500 from RLS leak)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/sales-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: {
          code: `${TEST_PREFIX}V`,
          soDate: '2026-05-02',
          customerName: 'Viewer Block',
          type: 'component_manufacturing',
          status: 'open',
          gstPercent: 18,
        },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1, rate: 0 }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
