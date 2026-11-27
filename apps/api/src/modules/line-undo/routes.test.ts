// ADR-324 line undo — routes: GET undo-list and POST undo-step, happy and
// error paths, on a fresh JWSO line nothing holds (TEST).

import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, notLike, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, items, jobWorkOrderLines, jobWorkOrders, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { lineUndoRoutes } from './routes';

const P = `TLUR${Date.now().toString(36).slice(-5).toUpperCase()}-`;
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let clientId: string;
let jwId: string;
let lineId: string;
let hadUndoChain: boolean | null = null;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(lineUndoRoutes);
  return app;
}

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  const companyId = u.companyId;
  const itemId = (
    await db
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.companyId, companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
      )
      .orderBy(asc(items.createdAt))
      .limit(1)
  )[0]!.id;
  clientId = (
    await db
      .insert(clients)
      .values({
        companyId,
        code: `${P}CLI`,
        name: 'Undo routes client',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  jwId = (
    await db
      .insert(jobWorkOrders)
      .values({
        companyId,
        code: `${P}JW`,
        jwDate: '2026-11-27',
        clientId,
        customerName: 'Undo routes client',
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  lineId = (
    await db
      .insert(jobWorkOrderLines)
      .values({
        companyId,
        jobWorkOrderId: jwId,
        lineNo: 1,
        itemId,
        partName: `${P}PART`,
        uom: 'NOS',
        orderQty: 10,
        status: 'open',
        createdBy: u.id,
        updatedBy: u.id,
      })
      .returning()
  )[0]!.id;
  const prev = (await db.execute(sql`
    SELECT undo_chain AS v FROM public.user_access WHERE user_id = ${u.id}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ v: boolean | null }>;
  hadUndoChain = prev[0]?.v ?? null;
});

afterAll(async () => {
  if (hadUndoChain !== null) {
    await db.execute(sql`
      UPDATE public.user_access SET undo_chain = ${hadUndoChain}
       WHERE user_id = ${admin.id}::uuid AND deleted_at IS NULL
    `);
  }
  await db.delete(jobWorkOrderLines).where(eq(jobWorkOrderLines.jobWorkOrderId, jwId));
  await db.delete(jobWorkOrders).where(eq(jobWorkOrders.id, jwId));
  await db.delete(clients).where(eq(clients.id, clientId));
});

describe('line-undo routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });
  const listUrl = (l: string) => `/job-work-orders/${jwId}/lines/${l}/undo-list`;
  const stepUrl = `/job-work-orders/${'{jw}'}/lines/${'{line}'}/undo-step`;
  const runUrl = () => stepUrl.replace('{jw}', jwId).replace('{line}', lineId);

  it('GET undo-list — 200 with the line and an empty list', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: listUrl(lineId) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lineId).toBe(lineId);
    expect(body.lineNo).toBe(1);
    expect(body.orderQty).toBe(10);
    expect(body.steps).toEqual([]);
    expect(typeof body.canUndo).toBe('boolean');
    expect(Array.isArray(body.undoHolders)).toBe(true);
  });

  it('GET undo-list — 404 for a line not on that JWSO, 401 without a user', async () => {
    app = await buildApp(admin);
    expect((await app.inject({ method: 'GET', url: listUrl(randomUUID()) })).statusCode).toBe(404);
    await app.close();
    app = await buildApp(null);
    expect((await app.inject({ method: 'GET', url: listUrl(lineId) })).statusCode).toBe(401);
  });

  it('POST undo-step — 400 without a reason', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'POST', url: runUrl(), payload: { stepKey: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('POST undo-step — 403 without the Undo chain right', async () => {
    app = await buildApp({ ...admin, id: randomUUID(), role: 'manager' });
    const res = await app.inject({
      method: 'POST',
      url: runUrl(),
      payload: { stepKey: 'x', reason: 'route test' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST undo-step — 409 when nothing holds the line', async () => {
    await db.execute(sql`
      UPDATE public.user_access SET undo_chain = true
       WHERE user_id = ${admin.id}::uuid AND deleted_at IS NULL
    `);
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: runUrl(),
      payload: { stepKey: 'cancel:party_grn:x', reason: 'route test' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message ?? res.body).toMatch(/Nothing holds this line/);
  });
});
