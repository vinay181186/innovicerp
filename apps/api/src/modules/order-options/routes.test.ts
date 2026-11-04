// Routes-layer tests for GET /order-options: login guard, search, kind, cancelled.
// Fixtures carry a unique prefix so a search returns only this file's rows.

import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import type { OrderOptionsResponse } from '@innovic/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, jobWorkOrders, salesOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { orderOptionsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const P = 'TORDOPT-';
const OPEN_SO = `${P}SO-OPEN`;
const CANCELLED_SO = `${P}SO-CANCELLED`;
const OPEN_JW = `${P}JW-OPEN`;
const INTERNAL_NO = `${P}INT-1`;
const SO_CLIENT_PO = `${P}CPO-SO`;

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(orderOptionsRoutes);
  return app;
}

async function cleanup(): Promise<void> {
  await db.delete(salesOrders).where(like(salesOrders.code, `${P}%`));
  await db.delete(jobWorkOrders).where(like(jobWorkOrders.code, `${P}%`));
  await db.delete(clients).where(like(clients.code, `${P}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await cleanup();

  const stamp = { companyId: u.companyId, createdBy: u.id, updatedBy: u.id };
  const client = (
    await db
      .insert(clients)
      .values({ ...stamp, code: `${P}CLI`, name: `${P}Client Master Name` })
      .returning({ id: clients.id })
  )[0]!;
  const so = {
    ...stamp,
    soDate: '2026-05-01',
    type: 'component_manufacturing' as const,
    gstPercent: '18.00',
  };
  await db.insert(salesOrders).values([
    {
      ...so,
      code: OPEN_SO,
      internalSoNo: INTERNAL_NO,
      clientId: client.id,
      customerName: 'Old name on the order',
      clientPoNo: SO_CLIENT_PO,
      status: 'open',
    },
    { ...so, code: CANCELLED_SO, customerName: 'Routes Smoke', status: 'cancelled' },
  ]);
  await db.insert(jobWorkOrders).values({
    ...stamp,
    code: OPEN_JW,
    jwDate: '2026-05-02',
    customerName: 'Routes Smoke',
    clientPoNo: `${P}CPO-JW`,
    status: 'open',
  });
});

afterAll(cleanup);

describe('order-options routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  async function codes(query: string): Promise<string[]> {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: `/order-options?${query}` });
    expect(res.statusCode).toBe(200);
    return (res.json() as OrderOptionsResponse).orders.map((o) => o.code).sort();
  }

  it('returns 401 without login', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/order-options' });
    expect(res.statusCode).toBe(401);
  });

  it('finds an order by Client PO No., and names the client master first', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: `/order-options?search=${encodeURIComponent(SO_CLIENT_PO)}`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OrderOptionsResponse).orders).toEqual([
      {
        kind: 'so',
        id: expect.any(String),
        code: OPEN_SO,
        internalSoNo: INTERNAL_NO,
        clientPoNo: SO_CLIENT_PO,
        customerName: `${P}Client Master Name`,
      },
    ]);
  });

  it('finds an order by the customer name kept on the order too', async () => {
    const res = await (
      await buildApp(admin)
    ).inject({
      method: 'GET',
      url: `/order-options?search=${encodeURIComponent('Old name on the order')}`,
    });
    const body = res.json<OrderOptionsResponse>();
    expect(body.orders.map((o) => o.code)).toContain(OPEN_SO);
  });

  it('refuses an over-long search', async () => {
    const res = await (
      await buildApp(admin)
    ).inject({
      method: 'GET',
      url: `/order-options?search=${'x'.repeat(101)}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('finds an SO by the label the dropdown re-sends from its box', async () => {
    const label = encodeURIComponent(`${OPEN_SO} · ${INTERNAL_NO}`);
    expect(await codes(`search=${label}`)).toEqual([OPEN_SO]);
  });

  it('kind narrows to SOs or to JWSOs; left out returns both', async () => {
    const search = `search=${encodeURIComponent(P)}`;
    expect(await codes(`${search}&kind=so`)).toEqual([CANCELLED_SO, OPEN_SO].sort());
    await app.close();
    expect(await codes(`${search}&kind=jwso`)).toEqual([OPEN_JW]);
    await app.close();
    expect(await codes(search)).toEqual([CANCELLED_SO, OPEN_JW, OPEN_SO].sort());
  });

  it('cancelled=exclude leaves cancelled orders out; the default keeps them', async () => {
    const search = `search=${encodeURIComponent(P)}`;
    expect(await codes(`${search}&cancelled=exclude`)).toEqual([OPEN_JW, OPEN_SO].sort());
    await app.close();
    expect(await codes(`${search}&cancelled=include`)).toContain(CANCELLED_SO);
  });
});
