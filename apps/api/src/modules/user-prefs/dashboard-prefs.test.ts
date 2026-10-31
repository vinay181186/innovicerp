// ADR-262 — the home's "Lists open as" + per-check open state, stored in
// user_ui_settings (dashboard_list_open, one dash_open_<checkKey> row per
// check). Pure reader first, then a round trip on the TEST database only.

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import type { UiSettings } from '@innovic/shared';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
/** TEST Supabase project ref — DB tests are skipped against any other database. */
const ON_TEST_DB = (process.env.DATABASE_URL ?? '').includes('uitsrhyulidubnddzcex');

describe('settingsFromRows', () => {
  it('fills defaults when nothing is stored', () => {
    expect(service.settingsFromRows([])).toEqual({
      tableDensity: 'comfortable',
      dashboardListOpen: 'collapsed',
      dashboardCheckOpen: {},
    });
  });

  it('reads list-open and one row per check; unknown values fall back', () => {
    expect(
      service.settingsFromRows([
        { key: 'table_density', value: 'compact' },
        { key: 'dashboard_list_open', value: 'expanded' },
        { key: 'dash_open_sales_overdue', value: 'open' },
        { key: 'dash_open_pur_po_overdue', value: 'closed' },
        { key: 'notifications_seen_at', value: '2026-10-31T00:00:00.000Z' },
      ]),
    ).toEqual({
      tableDensity: 'compact',
      dashboardListOpen: 'expanded',
      dashboardCheckOpen: { sales_overdue: true, pur_po_overdue: false },
    });
    expect(
      service.settingsFromRows([{ key: 'dashboard_list_open', value: 'sideways' }])
        .dashboardListOpen,
    ).toBe('collapsed');
  });
});

describe.skipIf(!ON_TEST_DB)('dashboard prefs (DB, TEST project only)', () => {
  let admin: AuthContext;
  let saved: UiSettings | undefined;

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
    saved = await service.getUiSettings(admin);
  });

  afterAll(async () => {
    if (!admin || !saved) return;
    await service.saveUiSettings(
      { tableDensity: saved.tableDensity, dashboardListOpen: saved.dashboardListOpen },
      admin,
    );
    const checks = Object.entries(saved.dashboardCheckOpen);
    if (checks.length)
      await service.saveUiSettings(
        { dashboardCheckOpen: checks.map(([checkKey, open]) => ({ checkKey, open })) },
        admin,
      );
  });

  it('a partial save changes only what was sent', async () => {
    const before = await service.getUiSettings(admin);
    const after = await service.saveUiSettings(
      { dashboardCheckOpen: [{ checkKey: 'sales_overdue', open: true }] },
      admin,
    );
    expect(after.tableDensity).toBe(before.tableDensity);
    expect(after.dashboardListOpen).toBe(before.dashboardListOpen);
    expect(after.dashboardCheckOpen['sales_overdue']).toBe(true);
  });

  it('changing "Lists open as" clears every per-check override', async () => {
    await service.saveUiSettings(
      {
        dashboardCheckOpen: [
          { checkKey: 'sales_overdue', open: true },
          { checkKey: 'store_po_grn', open: false },
        ],
      },
      admin,
    );
    const out = await service.saveUiSettings({ dashboardListOpen: 'expanded' }, admin);
    expect(out.dashboardListOpen).toBe('expanded');
    expect(out.dashboardCheckOpen).toEqual({});
    expect((await service.getUiSettings(admin)).dashboardCheckOpen).toEqual({});
  });

  it('per-check rows sent with a list-open change survive the clear', async () => {
    const out = await service.saveUiSettings(
      {
        dashboardListOpen: 'collapsed',
        dashboardCheckOpen: [{ checkKey: 'plan_rc_approval', open: true }],
      },
      admin,
    );
    expect(out.dashboardCheckOpen).toEqual({ plan_rc_approval: true });
  });
});
