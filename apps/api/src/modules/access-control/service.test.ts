// Access Control service tests. Uses seed admin + seed viewer.
//
// Cleanup discipline per feedback_test_activity_log_cleanup: scope removes
// to the target user (viewer) only, never entity-wide.

import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

let admin: AuthContext;
let viewer: AuthContext;
let viewerOriginalAccess: {
  fullAccess: boolean;
  departments: Record<string, boolean>;
  forms: Record<string, { view: boolean; entry: boolean; edit: boolean }>;
} | null = null;

beforeAll(async () => {
  const adminRows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const a = adminRows[0];
  if (!a || !a.companyId) throw new Error('Seed admin missing');
  admin = { id: a.id, email: a.email, companyId: a.companyId, role: a.role, isActive: a.isActive };

  const viewerRows = await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)).limit(1);
  const v = viewerRows[0];
  if (!v || !v.companyId) throw new Error('Seed viewer missing');
  viewer = {
    id: v.id,
    email: v.email,
    companyId: v.companyId,
    role: v.role,
    isActive: v.isActive,
  };

  // Snapshot the viewer's pre-existing access row (from migration backfill)
  // so we can restore exactly in afterAll.
  const acRows = await db
    .select()
    .from(userAccess)
    .where(and(eq(userAccess.userId, viewer.id), eq(userAccess.companyId, viewer.companyId!)))
    .limit(1);
  const ac = acRows[0];
  if (ac) {
    viewerOriginalAccess = {
      fullAccess: ac.fullAccess,
      departments: (ac.departments as Record<string, boolean>) ?? {},
      forms:
        (ac.forms as Record<string, { view: boolean; entry: boolean; edit: boolean }>) ?? {},
    };
  }
});

afterAll(async () => {
  // Restore the viewer's access row exactly, and remove any activity-log
  // rows our saves emitted (scoped to viewer's userId — never entity-wide).
  if (viewerOriginalAccess) {
    await db
      .update(userAccess)
      .set({
        fullAccess: viewerOriginalAccess.fullAccess,
        departments: viewerOriginalAccess.departments,
        forms: viewerOriginalAccess.forms,
        updatedBy: admin.id,
      })
      .where(eq(userAccess.userId, viewer.id));
  }
  await db
    .delete(activityLog)
    .where(and(eq(activityLog.entity, 'Access Control'), eq(activityLog.refId, viewer.id)));
});

describe('access-control service', () => {
  it('listUserAccess returns admin + viewer; admin-only', async () => {
    const result = await service.listUserAccess(admin);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.some((u) => u.userEmail === ADMIN_EMAIL)).toBe(true);
    expect(result.items.some((u) => u.userEmail === VIEWER_EMAIL)).toBe(true);
  });

  it('listUserAccess rejects non-admin', async () => {
    await expect(service.listUserAccess(viewer)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('getUserAccess returns viewer row; admin-only', async () => {
    const ac = await service.getUserAccess(viewer.id, admin);
    expect(ac.userId).toBe(viewer.id);
    expect(typeof ac.fullAccess).toBe('boolean');
  });

  it('getUserAccess throws NotFoundError for unknown id', async () => {
    await expect(
      service.getUserAccess('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('getUserAccess rejects non-admin', async () => {
    await expect(service.getUserAccess(viewer.id, viewer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('saveUserAccess upserts and applies View/Entry/Edit cascade', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        departments: { sales: true, qc: true, design: false },
        forms: {
          so_create: { view: false, entry: false, edit: true }, // edit ⇒ all three
          qc_submit: { view: false, entry: true, edit: false }, // entry ⇒ view+entry
          item_create: { view: true, entry: false, edit: false }, // view only
        },
      },
      admin,
    );
    expect(saved.fullAccess).toBe(false);
    expect(saved.departments.sales).toBe(true);
    expect(saved.departments.design).toBeFalsy();
    expect(saved.forms.so_create).toEqual({ view: true, entry: true, edit: true });
    expect(saved.forms.qc_submit).toEqual({ view: true, entry: true, edit: false });
    expect(saved.forms.item_create).toEqual({ view: true, entry: false, edit: false });
  });

  it('saveUserAccess drops unknown dept/form keys silently', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        departments: { sales: true, fictional_dept: true },
        forms: {
          so_create: { view: true, entry: false, edit: false },
          fictional_form_key: { view: true, entry: false, edit: false },
        },
      },
      admin,
    );
    expect(saved.departments.fictional_dept).toBeUndefined();
    expect(saved.forms.fictional_form_key).toBeUndefined();
    expect(saved.departments.sales).toBe(true);
    expect(saved.forms.so_create).toBeDefined();
  });

  it('saveUserAccess fullAccess=true overrides cleanly', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      { fullAccess: true, departments: {}, forms: {} },
      admin,
    );
    expect(saved.fullAccess).toBe(true);
    expect(saved.departments).toEqual({});
    expect(saved.forms).toEqual({});
  });

  it('saveUserAccess rejects non-admin', async () => {
    await expect(
      service.saveUserAccess(
        viewer.id,
        { fullAccess: false, departments: {}, forms: {} },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('saveUserAccess emits ACCESS activity log row', async () => {
    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        departments: { sales: true },
        forms: {},
      },
      admin,
    );
    const rows = await db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entity, 'Access Control'), eq(activityLog.refId, viewer.id)))
      .limit(5);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.action).toBe('ACCESS');
  });

  it('getMyAccess returns caller-effective access (post-cascade)', async () => {
    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        departments: { sales: true },
        // Edit-only on purchase line should cascade to all three at read time.
        forms: { po_create: { view: false, entry: false, edit: true } },
        // Plus an entry-only on qc.
      },
      admin,
    );
    const my = await service.getMyAccess(viewer);
    expect(my.fullAccess).toBe(false);
    expect(my.departments.sales).toBe(true);
    expect(my.forms.po_create).toEqual({ view: true, entry: true, edit: true });
  });

  it('getMyAccess fails closed (deny everything) when no row exists', async () => {
    // Build a synthetic AuthContext for a non-existent user — getMyAccess
    // should return empty grants rather than throw.
    const ghost: AuthContext = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'ghost@innovic.test',
      companyId: viewer.companyId!,
      role: 'viewer',
      isActive: true,
    };
    const my = await service.getMyAccess(ghost);
    expect(my.fullAccess).toBe(false);
    expect(my.departments).toEqual({});
    expect(my.forms).toEqual({});
  });
});
