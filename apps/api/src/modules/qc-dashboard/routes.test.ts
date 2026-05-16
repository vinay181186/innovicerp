import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { qcDashboardRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(qcDashboardRoutes);
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

describe('qc-dashboard routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /qc-dashboard returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/qc-dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /qc-dashboard returns 200 + full payload for admin', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/qc-dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('generatedAt');
    expect(body).toHaveProperty('month');
    expect(body).toHaveProperty('summary');
    expect(body.summary).toHaveProperty('pendingCalls');
    expect(body).toHaveProperty('pending');
    expect(body).toHaveProperty('engineerPerf');
    expect(body).toHaveProperty('topRejectionReasons');
    expect(Array.isArray(body.engineers)).toBe(true);
  });

  it('GET /qc-dashboard returns 403 for operator role', async () => {
    const operator: AuthContext = { ...admin, role: 'operator' };
    app = await buildApp(operator);
    const res = await app.inject({ method: 'GET', url: '/qc-dashboard' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /qc-dashboard?month=invalid returns 400 (zod refine)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/qc-dashboard?month=2026/05' });
    expect(res.statusCode).toBe(400);
  });

  it('GET /qc-dashboard?engineer=foo echoes the engineer filter back', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/qc-dashboard?engineer=NoSuchEng' });
    expect(res.statusCode).toBe(200);
    expect(res.json().engineer).toBe('NoSuchEng');
  });
});
