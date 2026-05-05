// Activity log service tests (T-051).
//
// Read-only — runs against the 14 migrated rows. No fixture creation
// for v1; appendActivityLog is exercised by an inserted-then-deleted
// test row prefixed `T051-` so global-setup wipes leftovers.

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const PREFIX = 'T051-';

let admin: AuthContext;

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
  // Clean up any T051- prefixed entries from append tests.
  await db
    .delete(activityLog)
    .where(
      and(eq(activityLog.companyId, admin.companyId!), like(activityLog.entity, `${PREFIX}%`)),
    );
});

describe('activity-log service', () => {
  it('listActivityLog returns the migrated 14 rows ordered by ts desc', async () => {
    const result = await service.listActivityLog({ limit: 50, offset: 0 }, admin);
    expect(result.total).toBeGreaterThanOrEqual(14);
    expect(result.entries.length).toBeGreaterThanOrEqual(14);
    for (let i = 1; i < result.entries.length; i++) {
      const prev = result.entries[i - 1]!.ts;
      const curr = result.entries[i]!.ts;
      expect(prev >= curr).toBe(true);
    }
  });

  it('returns distinct actions + users for filter dropdowns', async () => {
    const result = await service.listActivityLog({ limit: 50, offset: 0 }, admin);
    expect(Array.isArray(result.actions)).toBe(true);
    expect(Array.isArray(result.users)).toBe(true);
    // Migrated data has Japan as a user_name (user_id=null per ADR-019).
    expect(result.users.some((u) => u.name === 'Japan')).toBe(true);
    // At least one well-known legacy action.
    expect(result.actions.length).toBeGreaterThan(0);
  });

  it('search filter narrows by substring across multiple columns', async () => {
    const result = await service.listActivityLog({ search: 'Item', limit: 50, offset: 0 }, admin);
    for (const e of result.entries) {
      const haystack = `${e.action} ${e.entity} ${e.detail} ${e.userName} ${e.refId ?? ''}`;
      expect(haystack.toLowerCase()).toContain('item');
    }
  });

  it('action filter exact-matches', async () => {
    const all = await service.listActivityLog({ limit: 50, offset: 0 }, admin);
    const knownAction = all.actions[0];
    if (!knownAction) return; // skip if seed empty
    const filtered = await service.listActivityLog(
      { action: knownAction, limit: 50, offset: 0 },
      admin,
    );
    for (const e of filtered.entries) {
      expect(e.action).toBe(knownAction);
    }
  });

  it('date range filter narrows results', async () => {
    const future = await service.listActivityLog(
      { fromDate: '2099-01-01', limit: 50, offset: 0 },
      admin,
    );
    expect(future.total).toBe(0);
    expect(future.entries).toHaveLength(0);
  });

  it('appendActivityLog inserts a new row visible in list immediately', async () => {
    const before = await service.listActivityLog({ limit: 1, offset: 0 }, admin);
    await service.appendActivityLog(
      { action: 'TEST', entity: `${PREFIX}entity`, detail: 'unit test row' },
      admin,
    );
    const after = await service.listActivityLog({ search: PREFIX, limit: 50, offset: 0 }, admin);
    expect(after.entries.length).toBeGreaterThan(0);
    const newest = after.entries[0]!;
    expect(newest.entity).toBe(`${PREFIX}entity`);
    expect(newest.action).toBe('TEST');
    expect(newest.detail).toBe('unit test row');
    expect(newest.userId).toBe(admin.id);
    expect(newest.userName).toBe(admin.email);
    // Total grew on the unfiltered list.
    const afterAll = await service.listActivityLog({ limit: 1, offset: 0 }, admin);
    expect(afterAll.total).toBeGreaterThan(before.total);
  });

  it('rejects users without a company assignment', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.listActivityLog({ limit: 10, offset: 0 }, orphan)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      service.appendActivityLog({ action: 'X', entity: 'Y' }, orphan),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('limit + offset pagination works', async () => {
    const page1 = await service.listActivityLog({ limit: 5, offset: 0 }, admin);
    const page2 = await service.listActivityLog({ limit: 5, offset: 5 }, admin);
    if (page1.total > 5) {
      const ids1 = new Set(page1.entries.map((e) => e.id));
      for (const e of page2.entries) {
        expect(ids1.has(e.id)).toBe(false);
      }
    }
  });
});
