import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jcOps, jobCards, opLog, runningOps, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { opEntryRoutes } from './routes';

const TEST_PREFIX = 'T025R-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let testItemId: string;
let testJcId: string;
let testJcCode: string;
let testJcOpId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(opEntryRoutes);
  return app;
}

async function setupFixture(): Promise<void> {
  const itemRows = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}ITEM`,
      name: 'Routes Test Item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testItemId = itemRows[0]!.id;

  testJcCode = `${TEST_PREFIX}JC-001`;
  const jcRows = await db
    .insert(jobCards)
    .values({
      companyId: admin.companyId!,
      code: testJcCode,
      jcDate: '2026-05-01',
      itemId: testItemId,
      orderQty: 5,
      priority: 'normal',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testJcId = jcRows[0]!.id;

  const opRows = await db
    .insert(jcOps)
    .values({
      companyId: admin.companyId!,
      jobCardId: testJcId,
      opSeq: 1,
      operation: 'mill',
      opType: 'process',
      cycleTimeMin: '0.00',
      qcRequired: false,
      reworkQty: 0,
      outsourceCost: '0.00',
      outsourceSentQty: 0,
      outsourceReturnedQty: 0,
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testJcOpId = opRows[0]!.id;
}

async function teardownFixture(): Promise<void> {
  if (testJcOpId) {
    await db.delete(opLog).where(eq(opLog.jcOpId, testJcOpId));
    await db.delete(runningOps).where(eq(runningOps.jcOpId, testJcOpId));
    await db.delete(jcOps).where(eq(jcOps.id, testJcOpId));
  }
  if (testJcId) await db.delete(jobCards).where(eq(jobCards.id, testJcId));
  if (testItemId) await db.delete(items).where(eq(items.id, testItemId));
  await db.delete(jobCards).where(like(jobCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardownFixture();
  await setupFixture();
});

afterAll(async () => {
  await teardownFixture();
});

describe('op-entry routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /op-entry/jc-ops returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: `/op-entry/jc-ops?jobCardCode=${testJcCode}` });
    expect(res.statusCode).toBe(401);
  });

  it('GET /op-entry/jc-ops returns enriched ops with status', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: `/op-entry/jc-ops?jobCardCode=${testJcCode}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.['computedStatus']).toBeDefined();
  });

  it('POST /op-entry/op-log returns 201 and 403 for viewer', async () => {
    // happy path
    app = await buildApp(admin);
    const ok = await app.inject({
      method: 'POST',
      url: '/op-entry/op-log',
      headers: { 'content-type': 'application/json' },
      payload: { jcOpId: testJcOpId, qty: 1, rejectQty: 0, logDate: '2026-05-01', shift: 'day' },
    });
    expect(ok.statusCode).toBe(201);
    await app.close();

    // viewer should be blocked
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const denied = await app.inject({
      method: 'POST',
      url: '/op-entry/op-log',
      headers: { 'content-type': 'application/json' },
      payload: { jcOpId: testJcOpId, qty: 1, rejectQty: 0, logDate: '2026-05-01', shift: 'day' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: 'forbidden' });
  });

  it('POST /op-entry/op-log validates qty > 0', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/op-entry/op-log',
      headers: { 'content-type': 'application/json' },
      payload: { jcOpId: testJcOpId, qty: 0, logDate: '2026-05-01', shift: 'day' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });
});
