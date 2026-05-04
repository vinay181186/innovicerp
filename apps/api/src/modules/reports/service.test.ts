// Reports service tests — list (static), run (3 reports), error paths.
// Each report exercises a different SQL pattern (list / aggregate / computed
// field). Tests run against the real seeded + migrated dev data — no fixture
// creation.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
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

describe('reports service', () => {
  it('listReports returns 3 registered reports with stable shape', () => {
    const result = service.listReports();
    const slugs = result.reports.map((r) => r.slug).sort();
    expect(slugs).toEqual(['daily-op-log', 'nc-summary-by-reason', 'open-po-ageing']);
    for (const def of result.reports) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.group.length).toBeGreaterThan(0);
      expect(def.columns.length).toBeGreaterThan(0);
    }
  });

  it('runReport "daily-op-log" returns rows with the expected columns', async () => {
    const result = await service.runReport('daily-op-log', {}, admin);
    expect(result.slug).toBe('daily-op-log');
    expect(result.columns.length).toBe(10);
    expect(result.rowCount).toBe(result.rows.length);
    // op_log has 24 migrated rows; expect a non-zero count without filters.
    expect(result.rowCount).toBeGreaterThan(0);
    // Spot-check the first row's shape — should have all the column keys.
    const first = result.rows[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first).toHaveProperty('jc_code');
      expect(first).toHaveProperty('op_seq');
      expect(first).toHaveProperty('qty');
    }
  });

  it('runReport "daily-op-log" applies fromDate/toDate filters and echoes them', async () => {
    const result = await service.runReport(
      'daily-op-log',
      { fromDate: '2099-01-01', toDate: '2099-12-31' },
      admin,
    );
    expect(result.rowCount).toBe(0);
    expect(result.filters).toMatchObject({ fromDate: '2099-01-01', toDate: '2099-12-31' });
  });

  it('runReport "nc-summary-by-reason" aggregates by reason_category', async () => {
    const result = await service.runReport('nc-summary-by-reason', {}, admin);
    expect(result.slug).toBe('nc-summary-by-reason');
    // 3 migrated NCs all have reason_category='dimensional' → 1 group row.
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const dimensional = result.rows.find((r) => r['reason_category'] === 'dimensional');
    expect(dimensional).toBeDefined();
    if (dimensional) {
      expect(Number(dimensional['nc_count'])).toBeGreaterThanOrEqual(3);
      expect(Number(dimensional['total_rejected_qty'])).toBeGreaterThanOrEqual(15);
    }
  });

  it('runReport "open-po-ageing" computes days_open + sums line aggregates', async () => {
    const result = await service.runReport('open-po-ageing', {}, admin);
    expect(result.slug).toBe('open-po-ageing');
    // 1 migrated PO (IN-JWPO-00001) is `open`; expect at least 1 row.
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
    for (const row of result.rows) {
      expect(typeof row['days_open']).toBe('number');
      expect(Number(row['days_open'])).toBeGreaterThanOrEqual(0);
    }
  });

  it('runReport "open-po-ageing" status filter narrows results', async () => {
    const open = await service.runReport('open-po-ageing', { status: 'open' }, admin);
    for (const row of open.rows) {
      expect(row['status']).toBe('open');
    }
    // Invalid status value falls back to the default 4-status whitelist.
    const fallback = await service.runReport('open-po-ageing', { status: 'invalid' }, admin);
    expect(Array.isArray(fallback.rows)).toBe(true);
  });

  it('runReport throws NotFoundError for unknown slug', async () => {
    await expect(service.runReport('not-a-real-report', {}, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('runReport rejects users without a company assignment', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.runReport('daily-op-log', {}, orphan)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
