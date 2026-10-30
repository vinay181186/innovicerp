import type { AccessFormPerms, EffectiveAccess } from '@innovic/shared';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import * as accessService from '../access-control/service';
import { activityLogRoutes } from './routes';

// The real access read, wrapped so one test can stand in a non-admin's matrix
// (the seeded account is a Super Admin, who is never hidden).
vi.mock('../access-control/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../access-control/service')>();
  return { ...actual, getMyAccess: vi.fn(actual.getMyAccess) };
});

const NO_PERMS: AccessFormPerms = {
  view: false,
  entry: false,
  advance: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  advanceOff: false,
  editOff: false,
  approveOff: false,
};

/** A Tasks L1 user; `hidden` ticks "Hide page" on Activity Log. */
const tasksL1 = (hidden: boolean): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: { tasks: 'L1' },
  forms: hidden ? { activitylog_view: { ...NO_PERMS, viewOff: true } } : {},
});

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

async function buildApp(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(activityLogRoutes);
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

describe('activity-log routes', () => {
  let app: FastifyInstance;
  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /activity-log returns 401 without auth', async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: 'GET', url: '/activity-log' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /activity-log returns 200 + canonical shape for a non-admin with Activity Log View', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    vi.mocked(accessService.getMyAccess).mockResolvedValueOnce(tasksL1(false));
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/activity-log' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('entries');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('actions');
    expect(body).toHaveProperty('users');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('GET /activity-log returns 403 when Activity Log is hidden (Hide page)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    vi.mocked(accessService.getMyAccess).mockResolvedValueOnce(tasksL1(true));
    app = await buildApp(viewer);
    const res = await app.inject({ method: 'GET', url: '/activity-log' });
    expect(res.statusCode).toBe(403);
  });

  it('GET /activity-log?search=Item narrows + echoes filter via response shape', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/activity-log?search=Item&limit=10' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const e of body.entries) {
      const hay = `${e.action} ${e.entity} ${e.detail} ${e.userName} ${e.refId ?? ''}`;
      expect(hay.toLowerCase()).toContain('item');
    }
  });

  it('GET /activity-log returns 400 on invalid query (e.g. negative limit)', async () => {
    app = await buildApp(admin);
    const res = await app.inject({ method: 'GET', url: '/activity-log?limit=-5' });
    expect(res.statusCode).toBe(400);
  });
});
