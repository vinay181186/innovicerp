// ADR-312 — the "View all N" page against the TEST database: for every check
// the admin sees, the page total equals the home count and the rows come in
// the home's order; a search narrows the total; a check outside the caller's
// departments is 403. Read-only: rides on the seeded + migrated data.

import { DASH_CHECK_ROW_LIMIT, type DashCheck } from '@innovic/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../../db/client';
import { users } from '../../../db/schema';
import type { AuthContext } from '../../../db/with-user-context';
import { AuthorizationError } from '../../../lib/errors';
import { asAccess } from '../../../lib/test-access';
import { getCheckPage } from './page';
import { getChecks } from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const PAGE = { limit: 100, offset: 0 };

let admin: AuthContext;
let homeChecks: DashCheck[];

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
  homeChecks = (await getChecks(admin)).depts.flatMap((b) => b.checks);
}, 60_000);

describe('check page (ADR-312)', () => {
  it('every visible check: page total = home count, same first rows, same order', async () => {
    expect(homeChecks.length).toBeGreaterThan(0);
    for (const home of homeChecks) {
      const p = await getCheckPage(admin, home.key, PAGE);
      expect(p.check.count, home.key).toBe(home.count);
      expect(p.check.tone, home.key).toBe(home.tone);
      expect(p.total, home.key).toBe(home.count);
      expect(p.rows.length, home.key).toBe(Math.min(home.count, PAGE.limit));
      const n = Math.min(DASH_CHECK_ROW_LIMIT, p.rows.length);
      expect(
        p.rows.slice(0, n).map((r) => r.key),
        home.key,
      ).toEqual(home.rows.map((r) => r.key));
      expect(
        p.rows.slice(0, n).map((r) => r.docHref),
        home.key,
      ).toEqual(home.rows.map((r) => r.docHref));
    }
  }, 300_000);

  it('offset pages through the same order', async () => {
    const big = homeChecks.find((c) => c.count >= 3);
    if (!big) return; // TEST data has no check with 3 rows
    const all = await getCheckPage(admin, big.key, { limit: 3, offset: 0 });
    const second = await getCheckPage(admin, big.key, { limit: 1, offset: 1 });
    expect(second.total).toBe(big.count);
    expect(second.rows[0]?.key).toBe(all.rows[1]?.key);
  }, 60_000);

  it('a search narrows the total to rows that match it', async () => {
    const withRows = homeChecks.find((c) => c.count >= 1 && c.rows[0]?.docCode);
    if (!withRows) return;
    const code = withRows.rows[0]!.docCode;
    const hit = await getCheckPage(admin, withRows.key, { ...PAGE, search: code });
    expect(hit.total).toBeGreaterThanOrEqual(1);
    expect(hit.total).toBeLessThanOrEqual(withRows.count);
    expect(hit.check.count).toBe(withRows.count);
    expect(hit.rows.some((r) => r.docCode === code)).toBe(true);
    const miss = await getCheckPage(admin, withRows.key, {
      ...PAGE,
      search: 'zz-no-such-document-zz',
    });
    expect(miss.total).toBe(0);
    expect(miss.rows).toEqual([]);
  }, 60_000);

  it('a check outside the caller departments is 403', async () => {
    const salesOnly = asAccess(admin, { departments: { sales: 'L3' } }, 'manager');
    await expect(getCheckPage(salesOnly, 'pur_pr_pending', PAGE)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    // Their own department still opens.
    const own = await getCheckPage(salesOnly, 'sales_overdue', PAGE);
    expect(own.check.key).toBe('sales_overdue');
  }, 60_000);
});
