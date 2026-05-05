import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { reportsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(reportsRoutes);
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

describe('reports routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /reports returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/reports' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /reports returns the 9 registered report definitions for any role', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/reports' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reports).toHaveLength(9);
  });

  it('GET /reports/:slug runs and returns rows + columns + filters', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/reports/nc-summary-by-reason',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('nc-summary-by-reason');
    expect(Array.isArray(body.rows)).toBe(true);
    expect(Array.isArray(body.columns)).toBe(true);
  });

  it('GET /reports/:slug returns 404 for unknown slug', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/reports/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /reports/:slug?fromDate=... echoes filters in the response', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/reports/daily-op-log?fromDate=2099-01-01',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().filters).toMatchObject({ fromDate: '2099-01-01' });
  });

  it('GET /reports/:slug/export.xlsx returns an xlsx binary with correct headers', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/reports/daily-op-log/export.xlsx',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('attachment;');
    expect(res.headers['content-disposition']).toContain('daily-op-log');
    // xlsx files are zip archives — magic bytes "PK\x03\x04".
    const body = res.rawPayload;
    expect(body[0]).toBe(0x50); // P
    expect(body[1]).toBe(0x4b); // K
    expect(body[2]).toBe(0x03);
    expect(body[3]).toBe(0x04);
    // Sanity: a non-trivial xlsx is at least a few KB even when empty.
    expect(body.length).toBeGreaterThan(2000);
  });

  it('GET /reports/:slug/export.xlsx returns 404 for unknown slug', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/reports/nope/export.xlsx',
    });
    expect(res.statusCode).toBe(404);
  });
});
