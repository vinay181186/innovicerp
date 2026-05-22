// SO Planning routes tests (PL-4b). Auth + zod param validation + happy path.

import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, plans, salesOrderLines, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { soPlanningRoutes } from './routes';

const PREFIX = 'TSPLR-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let app: FastifyInstance;
let admin: AuthContext;
let soId: string;

async function teardown(): Promise<void> {
  await db.delete(plans).where(like(plans.code, `${PREFIX}%`));
  const sos = await db
    .select({ id: salesOrders.id })
    .from(salesOrders)
    .where(like(salesOrders.code, `${PREFIX}%`));
  for (const so of sos) {
    await db.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  }
  await db.delete(salesOrders).where(like(salesOrders.code, `${PREFIX}%`));
  await db.delete(items).where(like(items.code, `${PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await teardown();

  const itemRow = await db
    .insert(items)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}ITM`,
      name: 'Routes test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  const itemId = itemRow[0]!.id;

  const soRow = await db
    .insert(salesOrders)
    .values({
      companyId: admin.companyId!,
      code: `${PREFIX}SO-1`,
      soDate: '2026-05-01',
      customerName: 'Routes Customer',
      type: 'component_manufacturing',
      status: 'open',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  soId = soRow[0]!.id;
  await db.insert(salesOrderLines).values({
    companyId: admin.companyId!,
    salesOrderId: soId,
    lineNo: 1,
    itemId,
    partName: 'Routes Line 1',
    orderQty: 5,
    status: 'open',
    createdBy: admin.id,
    updatedBy: admin.id,
  });

  app = Fastify();
  await app.register(errorHandlerPlugin);
  app.addHook('preHandler', async (req) => {
    req.user = admin;
  });
  await app.register(soPlanningRoutes);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
  await teardown();
});

describe('GET /so-planning', () => {
  it('200 returns SO list with our test SO', async () => {
    const res = await app.inject({ method: 'GET', url: '/so-planning' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ soCode: string }> };
    expect(body.items.some((r) => r.soCode === `${PREFIX}SO-1`)).toBe(true);
  });

  it('401 when no user attached', async () => {
    const bare = Fastify();
    await bare.register(errorHandlerPlugin);
    await bare.register(soPlanningRoutes);
    const res = await bare.inject({ method: 'GET', url: '/so-planning' });
    expect(res.statusCode).toBe(401);
    await bare.close();
  });
});

describe('GET /so-planning/:id', () => {
  it('200 returns SO detail', async () => {
    const res = await app.inject({ method: 'GET', url: `/so-planning/${soId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { soId: string; lines: unknown[] };
    expect(body.soId).toBe(soId);
    expect(body.lines).toHaveLength(1);
  });

  it('400 bad uuid', async () => {
    const res = await app.inject({ method: 'GET', url: '/so-planning/not-a-uuid' });
    expect(res.statusCode).toBe(400);
  });

  it('404 unknown SO', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/so-planning/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});
