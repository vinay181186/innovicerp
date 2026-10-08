// Multi-Level BOM route tests (ADR-225). Mirrors bom-master/routes.test.ts.
// NOTE: writes to the database DATABASE_URL points at — never run on production.

import { eq, inArray, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, mlBoms, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { mlBomRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TMLBR-';

let admin: AuthContext;
let parentId: string;
let childId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(mlBomRoutes);
  return app;
}

async function cleanup(): Promise<void> {
  const ids = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(like(items.code, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  if (ids.length > 0) await db.delete(mlBoms).where(inArray(mlBoms.itemId, ids));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  await cleanup();
  const it = await db
    .insert(items)
    .values(
      ['PARENT', 'CHILD'].map((c) => ({
        companyId: u.companyId!,
        code: `${TEST_PREFIX}${c}`,
        name: `ML BOM routes ${c}`,
        revision: 'A',
        uom: 'NOS' as const,
        itemType: 'component' as const,
        createdBy: u.id,
        updatedBy: u.id,
      })),
    )
    .returning();
  parentId = it[0]!.id;
  childId = it[1]!.id;
});

afterAll(cleanup);

describe('ml-bom routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /ml-boms returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/ml-boms' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /ml-boms returns 201 + detail; tree + list answer', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/ml-boms',
      payload: {
        itemId: parentId,
        lines: [{ childItemId: childId, qtyPerSet: 3, bomType: 'purchase' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.code).toMatch(/^IN-MLB-\d{5}$/);
    expect(body.isDefault).toBe(true);
    expect(body.lines).toHaveLength(1);

    const tree = await app.inject({ method: 'GET', url: `/ml-boms/${body.id}/tree?qty=2` });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().exploded[0].explodedQty).toBe('6.000');

    const list = await app.inject({ method: 'GET', url: `/ml-boms?search=${TEST_PREFIX}PARENT` });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].lineCount).toBe(1);
  });

  it('POST /ml-boms refuses a BOM containing its own item (400)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/ml-boms',
      payload: {
        itemId: parentId,
        lines: [{ childItemId: parentId, qtyPerSet: 1, bomType: 'manufacture' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /ml-boms returns 403 for viewer', async () => {
    app = await buildApp({ ...admin, role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/ml-boms',
      payload: {
        itemId: parentId,
        lines: [{ childItemId: childId, qtyPerSet: 1, bomType: 'purchase' }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /ml-boms/:id with a stale expectedUpdatedAt returns 409', async () => {
    app = await buildApp(admin);
    const created = await app.inject({
      method: 'POST',
      url: '/ml-boms',
      payload: {
        itemId: parentId,
        lines: [{ childItemId: childId, qtyPerSet: 1, bomType: 'purchase' }],
      },
    });
    const b = created.json();
    const payload = {
      itemId: parentId,
      lines: [{ childItemId: childId, qtyPerSet: 2, bomType: 'purchase' }],
      expectedUpdatedAt: b.updatedAt,
    };
    const first = await app.inject({ method: 'PUT', url: `/ml-boms/${b.id}`, payload });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'PUT', url: `/ml-boms/${b.id}`, payload });
    expect(second.statusCode).toBe(409);
  });

  it('DELETE /ml-boms/:id returns 403 for manager (admin-only)', async () => {
    app = await buildApp({ ...admin, role: 'manager' });
    const list = await db.select({ id: mlBoms.id }).from(mlBoms).where(eq(mlBoms.itemId, parentId));
    const del = await app.inject({
      method: 'DELETE',
      url: `/ml-boms/${list[0]!.id}`,
      payload: { reason: 'test' },
    });
    expect(del.statusCode).toBe(403);
  });
});
