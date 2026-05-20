import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { qcProcesses, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { qcProcessesRoutes } from './routes';

const TEST_PREFIX = 'TQPR-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(qcProcessesRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

afterAll(async () => {
  await db.delete(qcProcesses).where(like(qcProcesses.code, `${TEST_PREFIX}%`));
});

describe('qcProcesses routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /qc-processes returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/qc-processes' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /qc-processes returns 200 with auth', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/qc-processes?limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('items');
  });

  it('POST /qc-processes returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/qc-processes',
      headers: { 'content-type': 'application/json' },
      payload: {
        code,
        description: 'Routes Alpha',
        defaultCycleTimeMin: 5,
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe(code);
  });

  it('POST /qc-processes returns 400 on Zod failure', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/qc-processes',
      headers: { 'content-type': 'application/json' },
      payload: { code: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
