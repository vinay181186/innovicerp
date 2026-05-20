import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { companies, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { companiesRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

let admin: AuthContext;
let viewer: AuthContext;
let originalName: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(companiesRoutes);
  return app;
}

beforeAll(async () => {
  const a = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!a || !a.companyId) throw new Error('Seed admin missing');
  admin = { id: a.id, email: a.email, companyId: a.companyId, role: a.role, isActive: a.isActive };

  const v = (await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)).limit(1))[0];
  if (!v || !v.companyId) throw new Error('Seed viewer missing');
  viewer = { id: v.id, email: v.email, companyId: v.companyId, role: v.role, isActive: v.isActive };

  const c = (
    await db.select().from(companies).where(eq(companies.id, admin.companyId!)).limit(1)
  )[0];
  if (!c) throw new Error('Seed company missing');
  originalName = c.name;
});

afterAll(async () => {
  await db
    .update(companies)
    .set({ name: originalName, updatedBy: admin.id })
    .where(eq(companies.id, admin.companyId!));
});

describe('companies routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /companies/me returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/companies/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /companies/me returns 200 for any authed user', async () => {
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/companies/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(viewer.companyId);
  });

  it('PATCH /companies/me returns 403 for non-admin', async () => {
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'PATCH',
      url: '/companies/me',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Anything' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /companies/me returns 200 for admin', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PATCH',
      url: '/companies/me',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'TestRoutes Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('TestRoutes Renamed');
  });
});
