import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { docNumbersRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_CLIENT = 'TDOCNUM-CLI';
const EXISTING_CODE = 'IN-SO-99001'; // seeded below → exists:true
const FREE_CODE = 'IN-SO-99002'; // never seeded → exists:false

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(docNumbersRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const cli = (
    await db
      .insert(clients)
      .values({
        companyId: u.companyId,
        code: TEST_CLIENT,
        name: 'Doc-number test client',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!;
  await db.insert(salesOrders).values({
    companyId: u.companyId,
    code: EXISTING_CODE,
    soDate: '2026-01-01',
    clientId: cli.id,
    type: 'component_manufacturing',
    status: 'open',
    gstPercent: '18',
    createdBy: u.id,
    updatedBy: u.id,
  });
});

afterAll(async () => {
  await db.delete(salesOrders).where(eq(salesOrders.code, EXISTING_CODE));
  await db.delete(clients).where(like(clients.code, `${TEST_CLIENT}%`));
});

describe('doc-numbers routes', () => {
  let app: FastifyInstance;

  it('401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/doc-numbers/check?type=sales_order' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('exists:true for a code already in the database', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: `/doc-numbers/check?type=sales_order&code=${EXISTING_CODE}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exists).toBe(true);
    expect(body.formatValid).toBe(true);
    await app.close();
  });

  it('exists:false for an available code, with a well-formed nextCode', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: `/doc-numbers/check?type=sales_order&code=${FREE_CODE}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.exists).toBe(false);
    expect(body.nextCode).toMatch(/^IN-SO-\d{5}$/);
    await app.close();
  });

  it('formatValid:false for a mis-formatted code', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/doc-numbers/check?type=sales_order&code=SO-1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().formatValid).toBe(false);
    await app.close();
  });

  it('returns the next code for PO + GRN types', async () => {
    app = await buildApp(admin);
    const po = await app.inject({ method: 'GET', url: '/doc-numbers/check?type=purchase_order' });
    const grn = await app.inject({ method: 'GET', url: '/doc-numbers/check?type=grn' });
    expect(po.json().nextCode).toMatch(/^IN-PO-\d{5}$/);
    expect(grn.json().nextCode).toMatch(/^IN-GRN-\d{5}$/);
    await app.close();
  });

  it('400 on unknown document type', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/doc-numbers/check?type=bogus' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
