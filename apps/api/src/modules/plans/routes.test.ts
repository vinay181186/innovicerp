// Plans routes tests (PL-3). Auth + zod-param validation + happy paths.

import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, planOps, plans, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { plansRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TPL3R-';
let admin: AuthContext;
let itemId: string;
let planId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(plansRoutes);
  return app;
}

async function teardown(): Promise<void> {
  await db.delete(plans).where(like(plans.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM`,
      name: 'PL-3 Routes Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  itemId = itemRows[0]!.id;

  const planRows = await db
    .insert(plans)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}SEED`,
      planDate: '2026-05-21',
      planStatus: 'in_planning',
      planType: 'manufacture',
      itemId,
      itemNameText: 'PL-3 Routes Item',
      orderQty: 10,
      planQty: 10,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  planId = planRows[0]!.id;
});

afterAll(async () => {
  await teardown();
});

describe('plans routes', () => {
  let app: FastifyInstance;

  it('GET /plans returns 401 without auth', async () => {
    app = await buildApp(null);
    try {
      const res = await app.inject({ method: 'GET', url: '/plans' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /plans returns 200 + list envelope for admin', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/plans' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body).toHaveProperty('total');
    } finally {
      await app.close();
    }
  });

  it('GET /plans?status=invalid returns 400', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/plans?status=garbage' });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /plans/:id returns 404 on unknown id', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/plans/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('POST /plans/:id/finalize transitions in_planning → planned (manufacture needs ops)', async () => {
    // Add an op first so finalize doesn't trip the "manufacture requires ops" guard.
    await db.insert(planOps).values({
      companyId: admin.companyId!,
      planId,
      opSeq: 1,
      operation: 'turn',
      opType: 'process',
      cycleTimeMin: '0',
      qcRequired: false,
      outsourceCost: '0',
      createdBy: admin.id,
      updatedBy: admin.id,
    });

    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'POST', url: `/plans/${planId}/finalize` });
      expect(res.statusCode).toBe(200);
      expect(res.json().planStatus).toBe('planned');
    } finally {
      await app.close();
    }
  });

  it('GET /planning-dashboard returns kpi envelope', async () => {
    app = await buildApp(admin);
    try {
      const res = await app.inject({ method: 'GET', url: '/planning-dashboard' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('kpi');
      expect(body.kpi).toHaveProperty('inPlanning');
      expect(body.kpi).toHaveProperty('planned');
    } finally {
      await app.close();
    }
  });
});
