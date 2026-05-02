import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jobWorkOrderLines, jobWorkOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { jobWorkOrdersRoutes } from './routes';

const TEST_PREFIX = 'T031R-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(jobWorkOrdersRoutes);
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
    .select({ id: jobWorkOrders.id })
    .from(jobWorkOrders)
    .where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  const ids = testHeaders.map((h) => h.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, id));
    }
    await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${TEST_PREFIX}%`));
  }
});

describe('job-work-orders routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /job-work-orders returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/job-work-orders' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /job-work-orders returns 200 with auth and lists items', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/job-work-orders?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /job-work-orders returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/job-work-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: { code, jwDate: '2026-05-02', customerName: 'Routes JW', status: 'open' },
        lines: [
          { partName: 'Routed Part', itemId: firstItemId, uom: 'NOS', orderQty: 5 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.lines).toHaveLength(1);
  });

  it('POST /job-work-orders returns 400 on Zod validation failure (no client info)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/job-work-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: { code: `${TEST_PREFIX}BAD`, jwDate: '2026-05-02', status: 'open' },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /job-work-orders returns clean 403 for viewer role (not 500)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/job-work-orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        header: { code: `${TEST_PREFIX}V`, jwDate: '2026-05-02', customerName: 'Viewer', status: 'open' },
        lines: [{ partName: 'X', itemId: firstItemId, uom: 'NOS', orderQty: 1 }],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
