import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { itemsRoutes } from './routes';

const TEST_PREFIX = 'T009R-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(itemsRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

afterAll(async () => {
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('items routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /items returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/items' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /items returns 200 with auth and lists items', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/items?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /items returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'application/json' },
      payload: { code, name: 'Routes Alpha', revision: 'A', uom: 'NOS', itemType: 'component' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.companyId).toBe(admin.companyId);
  });

  it('POST /items returns 400 on Zod validation failure', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'application/json' },
      payload: { code: '', name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /items returns clean 403 for viewer role (not 500 from RLS leak)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}V`,
        name: 'Viewer Block',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'forbidden' });
  });
});
