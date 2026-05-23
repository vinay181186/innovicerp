// Tests for current_auth_company_id() — the SECURITY DEFINER helper that backs
// the qc-docs Storage per-company RLS (migration 0041). The Storage policies
// themselves can't be exercised here (they apply to the `authenticated` role
// going through the Storage API with a real JWT; this harness connects as the
// migration role). What IS verifiable is the helper's core logic: derive the
// caller's company from public.users by the JWT `sub`, bypassing users RLS.

import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { users } from './schema';
import { db } from './client';
import { type AuthContext, withUserContext } from './with-user-context';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

let admin: AuthContext;

async function companyIdFor(user: AuthContext): Promise<string | null> {
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT public.current_auth_company_id() AS cid`,
    )) as unknown as Array<{ cid: string | null }>;
    return rows[0]?.cid ?? null;
  });
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('current_auth_company_id() — qc-docs Storage RLS helper', () => {
  it("returns the caller's company derived from the JWT sub (RLS-bypassing lookup)", async () => {
    expect(await companyIdFor(admin)).toBe(admin.companyId);
  });

  it('returns null when the JWT sub matches no user (no cross-company leak)', async () => {
    const ghost: AuthContext = { ...admin, id: ZERO_UUID };
    expect(await companyIdFor(ghost)).toBeNull();
  });
});
