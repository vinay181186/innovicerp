// Routes-layer tests for /so-status. Auth + Zod-param validation + happy path.
// Reuses the same dev-DB fixture pattern as service.test.ts but creates only
// the SO header (no lines / JCs / ops) — the routes layer is dumb and the
// per-line aggregation paths are covered by service.test.ts.

import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { soStatusRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TPL1R-';
let admin: AuthContext;
let soId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(soStatusRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));

  const inserted = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SO-1`,
      soDate: '2026-05-01',
      customerName: 'Routes Smoke',
      type: 'component_manufacturing',
      status: 'open',
      gstPercent: '18.00',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soId = inserted[0]!.id;
});

afterAll(async () => {
  await db.delete(salesOrders).where(like(salesOrders.code, `${TEST_PREFIX}%`));
});

describe('so-status routes', () => {
  let app: FastifyInstance;

  it('GET /so-status/:soId returns 401 without auth', async () => {
    app = await buildApp(null);
    try {
      const res = await app.inject({ method: 'GET', url: `/so-status/${soId}` });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /so-status/:soId returns 400 when soId is not a uuid', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/so-status/not-a-uuid' });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /so-status/:soId returns 404 on unknown id', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/so-status/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('GET /so-status/:soId returns 200 + valid envelope for an authed admin', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: `/so-status/${soId}` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.header.id).toBe(soId);
      expect(body.header.code).toBe(`${TEST_PREFIX}SO-1`);
      expect(Array.isArray(body.lines)).toBe(true);
      expect(typeof body.generatedAt).toBe('string');
    } finally {
      await app.close();
    }
  });
});
