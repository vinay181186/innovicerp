import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { usersRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

let admin: AuthContext;
let viewer: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(usersRoutes);
  return app;
}

beforeAll(async () => {
  const adminRows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const a = adminRows[0];
  if (!a || !a.companyId) throw new Error('Seed admin missing');
  admin = { id: a.id, email: a.email, companyId: a.companyId, role: a.role, isActive: a.isActive };

  const viewerRows = await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)).limit(1);
  const v = viewerRows[0];
  if (!v || !v.companyId) throw new Error('Seed viewer missing');
  viewer = {
    id: v.id,
    email: v.email,
    companyId: v.companyId,
    role: v.role,
    isActive: v.isActive,
  };
});

afterAll(async () => {
  // Make sure the routes test didn't leave a soft-delete or phone change.
  await db
    .update(users)
    .set({ deletedAt: null, phone: null, updatedBy: admin.id })
    .where(eq(users.email, VIEWER_EMAIL));
});

describe('users routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /users returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /users returns 403 for viewer', async () => {
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /users returns 200 for admin', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/users?limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
  });

  it('PATCH /users/:id returns 200 on valid input', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${viewer.id}`,
      headers: { 'content-type': 'application/json' },
      payload: { phone: '+91-1111111111' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe('+91-1111111111');
  });

  it('PATCH /users/:id returns 400 on bad role', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${viewer.id}`,
      headers: { 'content-type': 'application/json' },
      payload: { role: 'wizard' },
    });
    expect(res.statusCode).toBe(400);
  });
});
