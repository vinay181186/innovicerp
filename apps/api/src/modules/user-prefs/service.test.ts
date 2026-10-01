// Per-user table preferences (ADR-199). Pure helpers first, then a round trip
// against the DB on a throwaway table key that is reset afterwards.
// Needs migration 0189 on the target database.

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TABLE_KEY = 'test-user-prefs-service';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

afterAll(async () => {
  if (admin) await service.resetTableLayout(TABLE_KEY, admin);
});

describe('user-prefs pure helpers', () => {
  it('toDensity falls back to comfortable for unknown / missing values', () => {
    expect(service.toDensity('compact')).toBe('compact');
    expect(service.toDensity('comfortable')).toBe('comfortable');
    expect(service.toDensity('huge')).toBe('comfortable');
    expect(service.toDensity(undefined)).toBe('comfortable');
  });

  it('normaliseColumns forces position 0 pinned and visible', () => {
    const out = service.normaliseColumns([
      { columnKey: 'so_code', position: 0, pinned: false, hidden: true },
      { columnKey: 'qty', position: 1, pinned: false, hidden: true },
    ]);
    expect(out[0]).toEqual({ columnKey: 'so_code', position: 0, pinned: true, hidden: false });
    expect(out[1]).toEqual({ columnKey: 'qty', position: 1, pinned: false, hidden: true });
  });

  it('rowsToLayout sorts by position and reports the latest updatedAt', () => {
    const a = new Date('2026-10-01T10:00:00Z');
    const b = new Date('2026-10-01T11:00:00Z');
    const layout = service.rowsToLayout('so-master', [
      { columnKey: 'b', position: 1, pinned: false, hidden: false, updatedAt: b },
      { columnKey: 'a', position: 0, pinned: true, hidden: false, updatedAt: a },
    ]);
    expect(layout.columns.map((c) => c.columnKey)).toEqual(['a', 'b']);
    expect(layout.updatedAt).toBe(b.toISOString());
    expect(service.rowsToLayout('so-master', [])).toEqual({
      tableKey: 'so-master',
      columns: [],
      updatedAt: null,
    });
  });
});

describe('user-prefs service (DB)', () => {
  it('refuses a user with no company', async () => {
    await expect(service.getUiSettings({ ...admin, companyId: null })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('ui settings round trip', async () => {
    const before = await service.getUiSettings(admin);
    const flipped = before.tableDensity === 'compact' ? 'comfortable' : 'compact';
    expect((await service.saveUiSettings({ tableDensity: flipped }, admin)).tableDensity).toBe(
      flipped,
    );
    expect((await service.getUiSettings(admin)).tableDensity).toBe(flipped);
    await service.saveUiSettings({ tableDensity: before.tableDensity }, admin);
  });

  it('layout save upserts, retires dropped columns, and resets', async () => {
    await service.resetTableLayout(TABLE_KEY, admin);
    expect((await service.getTableLayout(TABLE_KEY, admin)).columns).toEqual([]);

    const first = await service.saveTableLayout(
      TABLE_KEY,
      {
        columns: [
          { columnKey: 'code', position: 0, pinned: false, hidden: false },
          { columnKey: 'qty', position: 1, pinned: false, hidden: false },
          { columnKey: 'old', position: 2, pinned: false, hidden: true },
        ],
      },
      admin,
    );
    expect(first.columns).toHaveLength(3);
    expect(first.columns[0]).toMatchObject({ columnKey: 'code', pinned: true, hidden: false });
    expect(first.updatedAt).not.toBeNull();

    const second = await service.saveTableLayout(
      TABLE_KEY,
      {
        columns: [
          { columnKey: 'qty', position: 0, pinned: true, hidden: false },
          { columnKey: 'code', position: 1, pinned: false, hidden: false },
        ],
      },
      admin,
    );
    expect(second.columns.map((c) => c.columnKey)).toEqual(['qty', 'code']);
    expect(second.columns.find((c) => c.columnKey === 'old')).toBeUndefined();

    const reset = await service.resetTableLayout(TABLE_KEY, admin);
    expect(reset).toEqual({ tableKey: TABLE_KEY, columns: [], updatedAt: null });
  });
});
