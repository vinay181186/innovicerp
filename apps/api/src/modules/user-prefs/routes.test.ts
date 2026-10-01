import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { userPrefsRoutes } from './routes';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TABLE_KEY = 'test-user-prefs-routes';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(userPrefsRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

afterAll(async () => {
  if (admin) await service.resetTableLayout(TABLE_KEY, admin);
});

describe('user-prefs routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /me/ui-settings returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/me/ui-settings' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /me/ui-settings returns a density for any role', async () => {
    app = await buildApp({ ...admin, role: 'viewer' });
    const res = await app.inject({ method: 'GET', url: '/me/ui-settings' });
    expect(res.statusCode).toBe(200);
    expect(['comfortable', 'compact']).toContain(res.json().tableDensity);
  });

  it('PUT /me/ui-settings rejects an unknown density', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PUT',
      url: '/me/ui-settings',
      payload: { tableDensity: 'huge' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid table key', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/me/table-layouts/Bad_Key' });
    expect(res.statusCode).toBe(400);
  });

  it('PUT rejects a column that is both pinned and hidden', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PUT',
      url: `/me/table-layouts/${TABLE_KEY}`,
      payload: { columns: [{ columnKey: 'a', position: 1, pinned: true, hidden: true }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT then GET then DELETE a layout', async () => {
    app = await buildApp(admin);
    const put = await app.inject({
      method: 'PUT',
      url: `/me/table-layouts/${TABLE_KEY}`,
      payload: {
        columns: [
          { columnKey: 'code', position: 0, pinned: false, hidden: false },
          { columnKey: 'qty', position: 1, pinned: false, hidden: true },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().columns[0]).toMatchObject({ columnKey: 'code', pinned: true });

    const get = await app.inject({ method: 'GET', url: `/me/table-layouts/${TABLE_KEY}` });
    expect(get.json().columns).toHaveLength(2);

    const del = await app.inject({ method: 'DELETE', url: `/me/table-layouts/${TABLE_KEY}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ tableKey: TABLE_KEY, columns: [], updatedAt: null });
  });
});
