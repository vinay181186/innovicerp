import { and, eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { jcOps, jobCards, qcAssignments, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { qcCommandRoutes } from './routes';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
let testOpId: string;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(qcCommandRoutes);
  return app;
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const found = await db
    .select({ id: jcOps.id })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(and(eq(jobCards.code, 'IN-JC-00002'), eq(jcOps.opSeq, 1)))
    .limit(1);
  if (!found[0]) throw new Error('Expected IN-JC-00002 Op 1 from seed migration');
  testOpId = found[0].id;
});

afterAll(async () => {
  await db.delete(qcAssignments).where(eq(qcAssignments.jcOpId, testOpId));
});

describe('qc-command routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /qc-command returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/qc-command' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /qc-command returns 200 + full payload for admin', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/qc-command' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('stats');
    expect(body).toHaveProperty('queue');
    expect(body).toHaveProperty('fpy');
    expect(body).toHaveProperty('rework');
    expect(Array.isArray(body.inspectors)).toBe(true);
  });

  it('POST /qc-command/pickup with a bad jcOpId returns 400 (zod)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/qc-command/pickup',
      payload: { jcOpId: 'not-a-uuid' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /qc-command/pickup succeeds for admin', async () => {
    app = await buildApp(admin);
    const res = await app.inject({
      method: 'POST',
      url: '/qc-command/pickup',
      payload: { jcOpId: testOpId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().jcOpId).toBe(testOpId);
  });

  it('POST /qc-command/assign by qc role returns 403', async () => {
    const qc: AuthContext = { ...admin, role: 'qc' };
    app = await buildApp(qc);
    const res = await app.inject({
      method: 'POST',
      url: '/qc-command/assign',
      payload: { jcOpId: testOpId, inspectorUserId: admin.id },
    });
    expect(res.statusCode).toBe(403);
  });
});
