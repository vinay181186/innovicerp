// Regression test for the Production SO List 500 (the query referenced a
// non-existent `sales_orders.due_date` column). The endpoint must return 200
// both with data and when no rows match.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

describe('prod-so-list service', () => {
  it('returns a well-formed response with data (no 500 from a bad column)', async () => {
    const res = await service.listProdSo({ limit: 50, offset: 0 }, admin);
    expect(Array.isArray(res.items)).toBe(true);
    expect(typeof res.total).toBe('number');
    // dueDate is sourced from the SO's lines (MIN), nullable when no lines.
    for (const row of res.items) {
      expect(['string', 'object']).toContain(typeof row.dueDate); // string | null
      expect(typeof row.soCode).toBe('string');
      expect(typeof row.balanceQty).toBe('number');
    }
  });

  it('returns an empty list (not an error) when nothing matches', async () => {
    const res = await service.listProdSo(
      { search: 'no-such-so-zzz-0000', limit: 50, offset: 0 },
      admin,
    );
    expect(res.items).toEqual([]);
  });
});
