// Alerts service is read-mostly + one upsert. Tests ride on the seeded
// + migrated data — no fixture creation needed for the read paths. Each
// test cleans only the alert_config codes IT touches; a global
// DELETE-by-company would race with the parallel routes.test.ts whose
// `afterEach` would otherwise wipe this file's in-flight overrides.

import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { alertConfig as alertConfigTable, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { listAlertDefinitions } from './registry';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ALL_CODES = listAlertDefinitions()
  .map((d) => d.code)
  .sort();

// Codes this suite mutates. Disjoint from routes.test.ts's TOUCHED_CODES
// (which uses 'AL-005' only) so the two files can run in parallel.
const TOUCHED_CODES = ['AL-001', 'AL-002', 'AL-003', 'AL-007'];

let admin: AuthContext;

async function clearTouchedOverrides(companyId: string): Promise<void> {
  await db
    .delete(alertConfigTable)
    .where(
      and(eq(alertConfigTable.companyId, companyId), inArray(alertConfigTable.code, TOUCHED_CODES)),
    );
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
  await clearTouchedOverrides(admin.companyId!);
});

afterEach(async () => {
  // Restore registry-default state for THIS suite's codes only — see comment
  // at file top. Other suites (routes.test.ts) own their own code set.
  await clearTouchedOverrides(admin.companyId!);
});

describe('alerts service — config', () => {
  it('listAlertConfig returns one entry per registry definition with defaults for codes this suite owns', async () => {
    const result = await service.listAlertConfig(admin);
    expect(result.entries.map((e) => e.code).sort()).toEqual(ALL_CODES);
    // Only assert defaults for codes this suite owns — codes owned by other
    // parallel test files (routes.test.ts: AL-005) may have overrides
    // mid-flight from those tests.
    for (const e of result.entries) {
      if (TOUCHED_CODES.includes(e.code)) {
        expect(e.active).toBe(e.defaultActive);
        expect(e.isOverridden).toBe(false);
      }
    }
  });

  it('setAlertActive(false) overrides defaultActive=true and shows isOverridden', async () => {
    const before = await service.listAlertConfig(admin);
    const al001Before = before.entries.find((e) => e.code === 'AL-001');
    expect(al001Before?.active).toBe(true);
    expect(al001Before?.isOverridden).toBe(false);

    await service.setAlertActive('AL-001', false, admin);

    const after = await service.listAlertConfig(admin);
    const al001After = after.entries.find((e) => e.code === 'AL-001');
    expect(al001After?.active).toBe(false);
    expect(al001After?.isOverridden).toBe(true);
    expect(al001After?.defaultActive).toBe(true); // default unchanged
  });

  it('setAlertActive is idempotent — second call updates the existing row, not duplicates', async () => {
    await service.setAlertActive('AL-002', false, admin);
    await service.setAlertActive('AL-002', true, admin);
    const after = await service.listAlertConfig(admin);
    const al002 = after.entries.find((e) => e.code === 'AL-002');
    expect(al002?.active).toBe(true);
    expect(al002?.isOverridden).toBe(true);

    // Verify only one row in alert_config for this code.
    const rows = await db
      .select()
      .from(alertConfigTable)
      .where(eq(alertConfigTable.companyId, admin.companyId!));
    const al002Rows = rows.filter((r) => r.code === 'AL-002');
    expect(al002Rows).toHaveLength(1);
  });

  it('setAlertActive rejects non-write roles (viewer)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(service.setAlertActive('AL-001', false, viewer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('setAlertActive rejects unknown code with NotFoundError', async () => {
    await expect(service.setAlertActive('AL-999', true, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('rejects users without a company assignment', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.listAlertConfig(orphan)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('alerts service — eval', () => {
  it('runAllAlerts returns shape + at least all suite-owned active alerts', async () => {
    const result = await service.runAllAlerts(admin);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const codes = new Set(result.alerts.map((a) => a.code));
    // Suite-owned codes default-active and not touched in this test → present.
    for (const c of TOUCHED_CODES) expect(codes.has(c)).toBe(true);
    for (const a of result.alerts) {
      expect(a.count).toBeGreaterThanOrEqual(0);
      expect(a.dept.length).toBeGreaterThan(0);
      expect(a.name.length).toBeGreaterThan(0);
    }
  });

  it('runAllAlerts excludes deactivated alerts', async () => {
    await service.setAlertActive('AL-001', false, admin);
    const result = await service.runAllAlerts(admin);
    expect(result.alerts.find((a) => a.code === 'AL-001')).toBeUndefined();
    // Other suite-owned codes remain present (we only deactivated AL-001).
    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain('AL-002');
    expect(codes).toContain('AL-003');
  });

  it('runAlert returns full drill-down records + columns', async () => {
    const result = await service.runAlert('AL-018', admin);
    expect(result.alert.code).toBe('AL-018');
    expect(result.alert.dept).toBe('qc');
    expect(result.alert.records.length).toBe(result.alert.count);
    expect(result.columns.length).toBeGreaterThan(0);
    // Each column has key + label + type.
    for (const c of result.columns) {
      expect(c.key.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(['text', 'number', 'date']).toContain(c.type);
    }
  });

  it('runAlert NotFoundError on unknown code', async () => {
    await expect(service.runAlert('AL-NOPE', admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runAllAlerts evaluates the same active alert independently of activation order', async () => {
    // Toggle several to verify summaries reflect current state, not cached.
    await service.setAlertActive('AL-002', false, admin);
    await service.setAlertActive('AL-003', false, admin);
    await service.setAlertActive('AL-007', false, admin);

    const result = await service.runAllAlerts(admin);
    const codes = result.alerts.map((a) => a.code);
    expect(codes).not.toContain('AL-002');
    expect(codes).not.toContain('AL-003');
    expect(codes).not.toContain('AL-007');

    // Re-enable one and confirm it shows up again.
    await service.setAlertActive('AL-003', true, admin);
    const result2 = await service.runAllAlerts(admin);
    expect(result2.alerts.map((a) => a.code)).toContain('AL-003');
  });

  it('AL-018 returns a count + records shape (NC pending disposition)', async () => {
    const result = await service.runAlert('AL-018', admin);
    expect(typeof result.alert.count).toBe('number');
    expect(result.alert.count).toBeGreaterThanOrEqual(0);
    expect(result.alert.records).toHaveLength(result.alert.count);
    // Each record carries the columns the definition declares.
    for (const rec of result.alert.records) {
      expect(rec).toHaveProperty('nc_code');
      expect(rec).toHaveProperty('rejected_qty');
      expect(rec).toHaveProperty('reason_category');
    }
  });
});
