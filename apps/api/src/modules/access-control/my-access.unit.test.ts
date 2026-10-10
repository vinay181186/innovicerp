// ADR-229 — one request reads the caller's access ONCE.
//
// The db client is replaced by a counter, so these tests prove HOW MANY reads
// happen and what is shared; what the read returns is covered by
// service.test.ts against a real database. This file never connects (the
// shared fake is test/unit/fake-db.ts); run it with no database and no .env
// via `pnpm --filter @innovic/api test:unit`.
// It lives apart from service.test.ts because it replaces the db module for
// the whole file, which that real-database suite cannot share.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveAccess } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { fakeDb as h, resetFakeDb } from '../../../test/unit/fake-db';

vi.mock('../../db/client', async () =>
  (await import('../../../test/unit/fake-db')).fakeDbClientModule(),
);

const { getMyAccess } = await import('./my-access');
const { openRequestScope } = await import('../../db/with-user-context');

const COMPANY = '00000000-0000-0000-0000-0000000000c1';
const ctx = (id = 'u1'): AuthContext => ({
  id,
  email: `${id}@innovic.test`,
  companyId: COMPANY,
  role: 'viewer',
  isActive: true,
});
// What the auth plugin hands every request.
const requestCtx = (id = 'u1') => openRequestScope(ctx(id));
const row = (fullAccess: boolean) => ({
  fullAccess,
  auditor: false,
  drawingDownload: false,
  departments: {},
  forms: { po: { view: true } },
});

beforeEach(resetFakeDb);

describe('getMyAccess — once per request (ADR-229)', () => {
  it('four guards in one request read the database once', async () => {
    const user = requestCtx();
    h.next.push(row(true));
    const answers = await Promise.all([
      getMyAccess(user),
      getMyAccess(user),
      getMyAccess(user),
      getMyAccess(user),
    ]);
    expect(h.reads).toBe(1);
    expect(answers.every((a) => a.fullAccess)).toBe(true);
  });

  it('the read still sets the caller claims (RLS-safe)', async () => {
    h.next.push(row(true));
    await getMyAccess(requestCtx());
    expect(h.claimsSet).toBe(1);
  });

  it('the next request reads again — a right switched OFF bites on the next click', async () => {
    h.next.push(row(true), row(false));
    expect((await getMyAccess(requestCtx())).fullAccess).toBe(true);
    expect((await getMyAccess(requestCtx())).fullAccess).toBe(false);
    expect(h.reads).toBe(2);
  });

  it('a context without the request slot reads every time', async () => {
    const worker = ctx();
    h.next.push(row(true), row(false));
    expect((await getMyAccess(worker)).fullAccess).toBe(true);
    expect((await getMyAccess(worker)).fullAccess).toBe(false);
    expect(h.reads).toBe(2);
  });

  it('a spread copy of the request user does not carry the slot', async () => {
    const user = requestCtx();
    h.next.push(row(true), row(false));
    await getMyAccess(user);
    expect((await getMyAccess({ ...user })).fullAccess).toBe(false);
    expect(h.reads).toBe(2);
  });

  it('the shared answer is frozen — one guard cannot change what another sees', async () => {
    const user = requestCtx();
    h.next.push(row(true));
    const first = (await getMyAccess(user)) as EffectiveAccess;
    expect(() => {
      first.fullAccess = false;
    }).toThrow(TypeError);
    expect(() => {
      (first.forms as Record<string, unknown>)['po'] = undefined;
    }).toThrow(TypeError);
    expect(() => {
      (first.forms['po' as keyof typeof first.forms] as { view: boolean }).view = false;
    }).toThrow(TypeError);
    const second = await getMyAccess(user);
    expect(second.fullAccess).toBe(true);
    expect(h.reads).toBe(1);
  });

  it('opening the request scope twice is harmless and keeps the first scope', async () => {
    const user = requestCtx();
    h.next.push(row(true), row(false));
    await getMyAccess(user);
    expect(() => openRequestScope(user)).not.toThrow();
    expect((await getMyAccess(user)).fullAccess).toBe(true);
    expect(h.reads).toBe(1);
  });

  it('no access row still fails closed', async () => {
    h.next.push('none');
    expect(await getMyAccess(requestCtx())).toEqual({
      fullAccess: false,
      auditor: false,
      drawingDownload: false,
      departments: {},
      forms: {},
    });
  });

  it('a failed read is not remembered — the next guard tries again', async () => {
    const user = requestCtx();
    h.next.push(new Error('db down'), row(true));
    await expect(getMyAccess(user)).rejects.toThrow('db down');
    expect((await getMyAccess(user)).fullAccess).toBe(true);
    expect(h.reads).toBe(2);
  });

  it('a context without a scope gets a frozen answer too — every path behaves the same', async () => {
    h.next.push(row(true));
    const a = (await getMyAccess(ctx())) as EffectiveAccess;
    expect(Object.isFrozen(a)).toBe(true);
    expect(() => {
      a.fullAccess = false;
    }).toThrow(TypeError);
  });

  it('a context with no company is refused, not read', async () => {
    const user = openRequestScope({ ...ctx(), companyId: null });
    await expect(getMyAccess(user)).rejects.toThrow();
    expect(h.reads).toBe(0);
  });
});
