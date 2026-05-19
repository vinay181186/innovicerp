import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { bomMasters, items, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { bomMasterRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_PREFIX = 'TBOMR-';

let admin: AuthContext;
let testItemId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(bomMasterRoutes);
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
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
  const it = await db
    .insert(items)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}ITEM`,
      name: 'BOM routes test item',
      revision: 'A',
      uom: 'NOS',
      itemType: 'component',
      createdBy: admin.id,
      updatedBy: admin.id,
    })
    .returning();
  testItemId = it[0]!.id;
});

afterAll(async () => {
  await db.delete(bomMasters).where(like(bomMasters.bomNo, `${TEST_PREFIX}%`));
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('bom-master routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /bom-masters returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/bom-masters' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /bom-masters returns 201 + detail with revision row', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/bom-masters',
      payload: {
        bomNo: `${TEST_PREFIX}R1`,
        bomName: 'Routes test BOM',
        status: 'draft',
        lines: [{ childItemId: testItemId, qtyPerSet: 3, bomType: 'manufacture' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bomNo).toBe(`${TEST_PREFIX}R1`);
    expect(body.revision).toBe(1);
    expect(body.lines).toHaveLength(1);
    expect(body.revisions).toHaveLength(1);
  });

  it('POST /bom-masters returns 403 for viewer', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    app = await buildApp(viewer);
    const res = await app.inject({
      method: 'POST',
      url: '/bom-masters',
      payload: {
        bomNo: `${TEST_PREFIX}R-VIEWER`,
        bomName: 'should be denied',
        status: 'draft',
        lines: [{ childItemId: testItemId, qtyPerSet: 1, bomType: 'manufacture' }],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /bom-masters/:id returns 403 for manager (admin-only)', async () => {
    app = await buildApp(admin);
    const created = await app.inject({
      method: 'POST',
      url: '/bom-masters',
      payload: {
        bomNo: `${TEST_PREFIX}R-DEL`,
        bomName: 'del test',
        status: 'draft',
        lines: [{ childItemId: testItemId, qtyPerSet: 1, bomType: 'manufacture' }],
      },
    });
    const id = created.json().id;

    await app.close();
    const manager: AuthContext = { ...admin, role: 'manager' };
    app = await buildApp(manager);
    const del = await app.inject({ method: 'DELETE', url: `/bom-masters/${id}` });
    expect(del.statusCode).toBe(403);
  });
});
