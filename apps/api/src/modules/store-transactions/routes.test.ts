import { and, asc, eq, isNull, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { storeTransactionsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(storeTransactionsRoutes);
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
  const itemRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  firstItemId = itemRow[0]!.id;
});

describe('store-transactions routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /store-transactions returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/store-transactions' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /store-transactions returns 200 with auth and lists items', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/store-transactions?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
  });

  it('GET /store-transactions/item-balance/:itemId returns onHand', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: `/store-transactions/item-balance/${firstItemId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.itemId).toBe(firstItemId);
    expect(typeof body.onHand).toBe('number');
  });

  it('GET /store-transactions/item-balance/:itemId returns 400 on bad uuid', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'GET',
      url: '/store-transactions/item-balance/not-a-uuid',
    });
    expect(res.statusCode).toBe(400);
  });

  it('viewer role can read store-transactions (read-only ledger)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/store-transactions?limit=5' });
    expect(res.statusCode).toBe(200);
  });
});
