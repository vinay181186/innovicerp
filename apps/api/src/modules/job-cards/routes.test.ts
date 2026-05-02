import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { jobCardsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(jobCardsRoutes);
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

describe('job-cards routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /job-cards returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/job-cards' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /job-cards returns 200 with the canonical list shape', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/job-cards?limit=5' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 0) {
      const first = body.items[0];
      expect(first).toHaveProperty('code');
      expect(first).toHaveProperty('computedStatus');
      expect(first).toHaveProperty('totalOps');
      expect(first).toHaveProperty('sourceLink'); // may be null
    }
  });

  it('GET /job-cards rejects bad query (status enum)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/job-cards?status=not_a_status',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });
});
