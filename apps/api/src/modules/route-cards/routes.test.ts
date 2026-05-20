import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, items, machines, routeCards, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { routeCardRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TRCR-';

let admin: AuthContext;
let testItemId: string;
let testItemId2: string;
let testMachineId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(routeCardRoutes);
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
  await db.delete(routeCards).where(like(routeCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));

  const it = await db
    .insert(items)
    .values([
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}ITEM`,
        name: 'RC routes test item',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
      {
        companyId: u.companyId,
        code: `${TEST_PREFIX}ITEM2`,
        name: 'RC routes test item 2',
        revision: 'A',
        uom: 'NOS',
        itemType: 'component',
        createdBy: admin.id,
        updatedBy: admin.id,
      },
    ])
    .returning();
  testItemId = it[0]!.id;
  testItemId2 = it[1]!.id;

  const m = await db
    .insert(machines)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}MACH`,
      name: 'RC routes test machine',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testMachineId = m[0]!.id;
});

afterAll(async () => {
  await db.delete(activityLog).where(like(activityLog.refId, `${TEST_PREFIX}%`));
  await db.delete(routeCards).where(like(routeCards.code, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
});

describe('route-card routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /route-cards returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/route-cards' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /route-cards returns 201 + detail with revision row', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/route-cards',
      payload: {
        code: `${TEST_PREFIX}R1`,
        itemId: testItemId,
        ops: [
          {
            machineId: testMachineId,
            operation: 'turn',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(`${TEST_PREFIX}R1`);
    expect(body.currentRevision).toBe(1);
    expect(body.ops).toHaveLength(1);
    expect(body.revisions).toHaveLength(1);
  });

  it('POST /route-cards returns 403 for viewer', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/route-cards',
      payload: {
        code: `${TEST_PREFIX}R-VIEWER`,
        itemId: testItemId,
        ops: [
          {
            machineId: testMachineId,
            operation: 'x',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /route-cards/:id returns 403 for manager (admin-only)', async () => {
    app = await buildApp(admin);
    const created = await app.inject({
      method: 'POST',
      url: '/route-cards',
      payload: {
        code: `${TEST_PREFIX}R-DEL`,
        itemId: testItemId2,
        ops: [
          {
            machineId: testMachineId,
            operation: 'x',
            opType: 'process',
            cycleTimeMin: 1,
            qcRequired: false,
          },
        ],
      },
    });
    const id = created.json().id;

    await app.close();
    const manager: AuthContext = { ...admin, role: 'manager' };
    app = await buildApp(manager);
    const del = await app.inject({ method: 'DELETE', url: `/route-cards/${id}` });
    expect(del.statusCode).toBe(403);

    // Cleanup: admin closes the row so it doesn't pollute subsequent test runs.
    await db.delete(routeCards).where(eq(routeCards.id, id));
  });

  it('POST /route-cards returns 400 when ops is empty', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/route-cards',
      payload: { code: `${TEST_PREFIX}EMPTY`, itemId: testItemId, ops: [] },
    });
    expect(res.statusCode).toBe(400);
  });
});
