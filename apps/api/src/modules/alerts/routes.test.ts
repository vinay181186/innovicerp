import { and, eq, inArray } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { alertConfig as alertConfigTable, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { alertsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
// Codes this suite mutates. Disjoint from service.test.ts's TOUCHED_CODES
// so the two files can run in parallel without their cleanups colliding.
const TOUCHED_CODES = ['AL-005'];

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(alertsRoutes);
  return app;
}

async function clearTouched(companyId: string): Promise<void> {
  await db
    .delete(alertConfigTable)
    .where(
      and(eq(alertConfigTable.companyId, companyId), inArray(alertConfigTable.code, TOUCHED_CODES)),
    );
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
  await clearTouched(admin.companyId!);
});

afterEach(async () => {
  await clearTouched(admin.companyId!);
});

afterAll(async () => {
  await clearTouched(admin.companyId!);
});

describe('alerts routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /alerts returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/alerts' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /alerts returns 200 + summary list for any role', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/alerts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('generatedAt');
    expect(Array.isArray(body.alerts)).toBe(true);
    // Suite-owned codes default-active and untouched in this test → present.
    const codes = body.alerts.map((a: { code: string }) => a.code);
    expect(codes).toContain('AL-005');
  });

  it('GET /alerts/config returns 200 + 15 merged entries', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/alerts/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 15 always — registry definitions merged with overrides.
    expect(body.entries).toHaveLength(15);
    // For codes this suite owns, untouched at this point → defaults.
    const al005 = body.entries.find((e: { code: string }) => e.code === 'AL-005');
    expect(al005?.active).toBe(true);
    expect(al005?.isOverridden).toBe(false);
  });

  it('PUT /alerts/config/:code (admin) toggles override', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'PUT',
      url: '/alerts/config/AL-005',
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe('AL-005');
    expect(body.active).toBe(false);
    expect(body.isOverridden).toBe(true);

    // Confirm the change is observable via /alerts/config too.
    const list = await app.inject({ method: 'GET', url: '/alerts/config' });
    const al005 = list.json().entries.find((e: { code: string }) => e.code === 'AL-005');
    expect(al005.active).toBe(false);
  });

  it('PUT /alerts/config/:code (viewer) returns 403', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'PUT',
      url: '/alerts/config/AL-005',
      payload: { active: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /alerts/:code returns 404 for unknown code', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/alerts/AL-NOPE' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /alerts/:code returns 200 + drill-down records + columns', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/alerts/AL-018' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.alert.code).toBe('AL-018');
    expect(body.alert.dept).toBe('qc');
    expect(Array.isArray(body.alert.records)).toBe(true);
    expect(Array.isArray(body.columns)).toBe(true);
    expect(body.columns.length).toBeGreaterThan(0);
  });
});
