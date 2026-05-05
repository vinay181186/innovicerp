import { eq, like } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { savedReports, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { savedReportsRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const PREFIX = 'T041BR-';

let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(savedReportsRoutes);
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
});

afterAll(async () => {
  await db.delete(savedReports).where(like(savedReports.name, `${PREFIX}%`));
});

describe('saved-reports routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /saved-reports/sources returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/saved-reports/sources' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /saved-reports/sources returns the catalog', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/saved-reports/sources' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sources).toHaveLength(5);
  });

  it('POST /saved-reports → 201 + GET /:id round-trips', async () => {
    app = await buildApp(admin);
    const create = await app.inject({
      method: 'POST',
      url: '/saved-reports',
      payload: {
        name: `${PREFIX}roundtrip`,
        description: 'route test',
        sourceKey: 'job-cards',
        spec: {
          sourceKey: 'job-cards',
          columns: ['jc_code', 'jc_date', 'item_code', 'qty'],
          filters: [],
          groupBy: null,
          sumCol: null,
          sumFn: 'SUM',
          sort: [],
        },
        isShared: false,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = create.json();
    expect(created.id).toBeTruthy();

    const get = await app.inject({ method: 'GET', url: `/saved-reports/${created.id}` });
    expect(get.statusCode).toBe(200);
    expect(get.json().name).toBe(`${PREFIX}roundtrip`);
  });

  it('GET /saved-reports/:id/run returns rows + columns', async () => {
    app = await buildApp(admin);
    const create = await app.inject({
      method: 'POST',
      url: '/saved-reports',
      payload: {
        name: `${PREFIX}run-route`,
        description: '',
        sourceKey: 'job-cards',
        spec: {
          sourceKey: 'job-cards',
          columns: ['jc_code', 'qty'],
          filters: [],
          groupBy: null,
          sumCol: null,
          sumFn: 'SUM',
          sort: [{ field: 'jc_code', dir: 'asc' }],
        },
        isShared: false,
      },
    });
    const id = create.json().id;
    const run = await app.inject({ method: 'GET', url: `/saved-reports/${id}/run` });
    expect(run.statusCode).toBe(200);
    const body = run.json();
    expect(body.id).toBe(id);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.columns.map((c: { key: string }) => c.key)).toEqual(['jc_code', 'qty']);
  });

  it('POST /saved-reports/preview runs without persisting', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/saved-reports/preview',
      payload: {
        sourceKey: 'items-stock',
        columns: ['code', 'name', 'on_hand'],
        filters: [],
        groupBy: null,
        sumCol: null,
        sumFn: 'SUM',
        sort: [],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('preview');
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it('DELETE /saved-reports/:id returns 204 + makes it disappear from GET', async () => {
    app = await buildApp(admin);
    const create = await app.inject({
      method: 'POST',
      url: '/saved-reports',
      payload: {
        name: `${PREFIX}delete-route`,
        description: '',
        sourceKey: 'sales-orders',
        spec: {
          sourceKey: 'sales-orders',
          columns: ['so_code'],
          filters: [],
          groupBy: null,
          sumCol: null,
          sumFn: 'SUM',
          sort: [],
        },
        isShared: false,
      },
    });
    const id = create.json().id;
    const del = await app.inject({ method: 'DELETE', url: `/saved-reports/${id}` });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/saved-reports/${id}` });
    expect(after.statusCode).toBe(404);
  });

  it('GET /saved-reports/:id/export.xlsx returns an xlsx binary', async () => {
    app = await buildApp(admin);
    const create = await app.inject({
      method: 'POST',
      url: '/saved-reports',
      payload: {
        name: `${PREFIX}xlsx-export`,
        description: '',
        sourceKey: 'job-cards',
        spec: {
          sourceKey: 'job-cards',
          columns: ['jc_code', 'qty'],
          filters: [],
          groupBy: null,
          sumCol: null,
          sumFn: 'SUM',
          sort: [],
        },
        isShared: false,
      },
    });
    const id = create.json().id;
    const res = await app.inject({
      method: 'GET',
      url: `/saved-reports/${id}/export.xlsx`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('attachment;');
    const body = res.rawPayload;
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
    expect(body.length).toBeGreaterThan(2000);
  });

  it('POST /saved-reports/preview/export.xlsx returns an xlsx binary', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/saved-reports/preview/export.xlsx',
      payload: {
        sourceKey: 'items-stock',
        columns: ['code', 'name', 'on_hand'],
        filters: [],
        groupBy: null,
        sumCol: null,
        sumFn: 'SUM',
        sort: [],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain('preview');
    const body = res.rawPayload;
    expect(body[0]).toBe(0x50);
    expect(body[1]).toBe(0x4b);
  });

  it('POST /saved-reports rejects invalid spec with 400', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/saved-reports',
      payload: {
        name: `${PREFIX}bad`,
        description: '',
        sourceKey: 'sales-orders',
        spec: {
          sourceKey: 'sales-orders',
          columns: [], // empty → zod min(1) violation
          filters: [],
          groupBy: null,
          sumCol: null,
          sumFn: 'SUM',
          sort: [],
        },
        isShared: false,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
