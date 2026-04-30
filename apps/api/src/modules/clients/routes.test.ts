import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { clientsRoutes } from './routes';

const TEST_PREFIX = 'T017R-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(clientsRoutes);
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
  await db.delete(clients).where(like(clients.code, `${TEST_PREFIX}%`));
});

describe('clients routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /clients returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/clients' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /clients returns 200 with auth and lists clients', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/clients?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('clients');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.clients)).toBe(true);
  });

  it('POST /clients returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { 'content-type': 'application/json' },
      payload: { code, name: 'Routes Alpha', isActive: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.companyId).toBe(admin.companyId);
  });

  it('POST /clients returns 400 on Zod validation failure', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { 'content-type': 'application/json' },
      payload: { code: '', name: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });
});
