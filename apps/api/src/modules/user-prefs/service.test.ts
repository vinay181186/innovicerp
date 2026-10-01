// Per-user table preferences (ADR-199). Pure helpers first, then a round trip
// against the DB on a throwaway table key that is reset afterwards.
// The DB part runs ONLY against the TEST project (never PROD) and needs 0189/0190.

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { TableDensity } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TABLE_KEY = 'test-user-prefs-service';
/** TEST Supabase project ref — DB tests are skipped against any other database. */
const ON_TEST_DB = (process.env.DATABASE_URL ?? '').includes('uitsrhyulidubnddzcex');

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

  it('normaliseColumns renumbers 0..n-1 by position, ties in payload order', () => {
    const out = service.normaliseColumns([
      { columnKey: 'c', position: 9, pinned: false, hidden: false },
      { columnKey: 'a', position: 3, pinned: false, hidden: true },
      { columnKey: 'b', position: 3, pinned: false, hidden: false },
    ]);
    expect(out.map((c) => [c.columnKey, c.position])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(out[0]).toMatchObject({ pinned: true, hidden: false });
  });

  it('rowsToLayout keeps the given order and reports the latest updatedAt', () => {
    const a = new Date('2026-10-01T10:00:00Z');
    const b = new Date('2026-10-01T11:00:00Z');
    const layout = service.rowsToLayout('so-master', [
      { columnKey: 'a', position: 0, pinned: true, hidden: false, updatedAt: a },
      { columnKey: 'b', position: 1, pinned: false, hidden: false, updatedAt: b },
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

describe.skipIf(!ON_TEST_DB)('user-prefs service (DB, TEST project only)', () => {
  let admin: AuthContext;
  let savedDensity: TableDensity | undefined;

  beforeAll(async () => {
    const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
    const u = rows[0];
    if (!u || !u.companyId) throw new Error('Seed admin missing on the TEST database');
    admin = {
      id: u.id,
      email: u.email,
      companyId: u.companyId,
      role: u.role,
      isActive: u.isActive,
    };
    savedDensity = (await service.getUiSettings(admin)).tableDensity;
  });

  afterAll(async () => {
    if (!admin) return;
    await service.resetTableLayout(TABLE_KEY, admin);
    if (savedDensity) await service.saveUiSettings({ tableDensity: savedDensity }, admin);
  });

  it('refuses a user with no company', async () => {
    await expect(service.getUiSettings({ ...admin, companyId: null })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('ui settings round trip (restored in afterAll)', async () => {
    const flipped = savedDensity === 'compact' ? 'comfortable' : 'compact';
    expect((await service.saveUiSettings({ tableDensity: flipped }, admin)).tableDensity).toBe(
      flipped,
    );
    expect((await service.getUiSettings(admin)).tableDensity).toBe(flipped);
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
          { columnKey: 'qty', position: 4, pinned: false, hidden: true },
          { columnKey: 'code', position: 7, pinned: false, hidden: false },
        ],
      },
      admin,
    );
    expect(second.columns.map((c) => [c.columnKey, c.position])).toEqual([
      ['qty', 0],
      ['code', 1],
    ]);
    expect(second.columns[0]).toMatchObject({ pinned: true, hidden: false });
    expect(second.columns.find((c) => c.columnKey === 'old')).toBeUndefined();

    const reset = await service.resetTableLayout(TABLE_KEY, admin);
    expect(reset).toEqual({ tableKey: TABLE_KEY, columns: [], updatedAt: null });
  });
});
