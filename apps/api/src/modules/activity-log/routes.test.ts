import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { activityLogRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(activityLogRoutes);
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
});

describe('activity-log routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /activity-log returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/activity-log' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /activity-log returns 200 + canonical shape for any role (incl. viewer)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/activity-log' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('entries');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('actions');
    expect(body).toHaveProperty('users');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('GET /activity-log?search=Item narrows + echoes filter via response shape', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/activity-log?search=Item&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const e of body.entries) {
      const hay = `${e.action} ${e.entity} ${e.detail} ${e.userName} ${e.refId ?? ''}`;
      expect(hay.toLowerCase()).toContain('item');
    }
  });

  it('GET /activity-log returns 400 on invalid query (e.g. negative limit)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/activity-log?limit=-5' });
    expect(res.statusCode).toBe(400);
  });
});
