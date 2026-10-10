// ADR-229 — through the REAL auth plugin: each request gets its own scope, so
// four guards in one request read the caller's access once, and the next
// request reads again. Supabase and the database are replaced by fakes (the
// shared one is test/unit/fake-db.ts); nothing connects. Run with
// `pnpm --filter @innovic/api test:unit`.

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb, resetFakeDb } from '../../test/unit/fake-db';

vi.mock('../lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  },
}));

vi.mock('../db/client', async () => (await import('../../test/unit/fake-db')).fakeDbClientModule());

const { authPlugin } = await import('./auth');
const { getMyAccess } = await import('../modules/access-control/my-access');

async function buildApp() {
  const app = Fastify();
  await app.register(authPlugin);
  // A route with four guards, like the Approvals badge.
  app.get('/four-guards', async (req) => {
    const user = req.user!;
    const answers = await Promise.all([
      getMyAccess(user),
      getMyAccess(user),
      getMyAccess(user),
      getMyAccess(user),
    ]);
    return { fullAccess: answers.map((a) => a.fullAccess) };
  });
  return app;
}

const call = (app: Awaited<ReturnType<typeof buildApp>>) =>
  app.inject({ method: 'GET', url: '/four-guards', headers: { authorization: 'Bearer t' } });

const accessRow = (fullAccess: boolean) => ({
  fullAccess,
  auditor: false,
  drawingDownload: false,
  departments: {},
  forms: {},
});

beforeEach(resetFakeDb);

describe('auth plugin + getMyAccess (ADR-229)', () => {
  it('four guards in one real request read access once', async () => {
    const app = await buildApp();
    fakeDb.next.push(accessRow(true));
    const res = await call(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ fullAccess: [true, true, true, true] });
    expect(fakeDb.reads).toBe(1);
  });

  it('the next request reads again — a right switched OFF bites on the next click', async () => {
    const app = await buildApp();
    // The admin switches it off between the two clicks.
    fakeDb.next.push(accessRow(true), accessRow(false));
    await call(app);
    const res = await call(app);
    expect(res.json()).toEqual({ fullAccess: [false, false, false, false] });
    expect(fakeDb.reads).toBe(2);
  });
});
