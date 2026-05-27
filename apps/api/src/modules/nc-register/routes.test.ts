import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jobCards, ncRegister, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { ncRegisterRoutes } from './routes';

const TEST_PREFIX = 'T040AR-NC-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstJobCardId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(ncRegisterRoutes);
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
  const jcRow = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.companyId, u.companyId),
        isNull(jobCards.deletedAt),
        notLike(jobCards.code, 'T%-%'),
      ),
    )
    .orderBy(asc(jobCards.createdAt))
    .limit(1);
  firstJobCardId = jcRow[0]!.id;
});

afterAll(async () => {
  await db.delete(ncRegister).where(like(ncRegister.code, `${TEST_PREFIX}%`));
});

describe('nc-register routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /nc-register returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/nc-register' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /nc-register returns 200 with auth and shape', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/nc-register?limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /nc-register returns 201 on valid input', async () => {
    app = await buildApp(admin);
    const code = `${TEST_PREFIX}A`;
    const res = await app.inject({
      method: 'POST',
      url: '/nc-register',
      headers: { 'content-type': 'application/json' },
      payload: {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 5,
        reasonCategory: 'dimensional',
        reason: 'route create defect',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toBe(code);
    expect(body.status).toBe('pending');
  });

  it('POST /nc-register returns 400 on missing required field', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/nc-register',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}BAD`,
        ncDate: '2026-05-04',
        // jobCardId missing
        itemId: firstItemId,
        rejectedQty: 1,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('POST /nc-register returns 403 for viewer; 201 for operator', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const viewerRes = await app.inject({
      method: 'POST',
      url: '/nc-register',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}V`,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
        reason: 'viewer route defect',
      },
    });
    expect(viewerRes.statusCode).toBe(403);
    expect(viewerRes.json()).toMatchObject({ error: 'forbidden' });
    await app.close();

    const operator: AuthContext = { ...admin, role: 'operator' };
    app = await buildApp(operator);
    const opRes = await app.inject({
      method: 'POST',
      url: '/nc-register',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: `${TEST_PREFIX}OP`,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
        reason: 'operator route defect',
      },
    });
    expect(opRes.statusCode).toBe(201);
  });
});
