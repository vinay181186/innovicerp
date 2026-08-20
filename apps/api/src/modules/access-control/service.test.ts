// Access Control service tests. Uses seed admin + seed viewer.
//
// Cleanup discipline per feedback_test_activity_log_cleanup: scope removes
// to the target user (viewer) only, never entity-wide.

import type { AccessFormPerms, AccessTierKey } from '@innovic/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

// Shorthand for the four-action perms literal the tests pass in.
const perms = (p: Partial<AccessFormPerms>): AccessFormPerms => ({
  view: false,
  entry: false,
  edit: false,
  approve: false,
  ...p,
});

let admin: AuthContext;
let viewer: AuthContext;
let viewerOriginalAccess: {
  fullAccess: boolean;
  auditor: boolean;
  departments: Record<string, boolean | AccessTierKey>;
  forms: Record<string, AccessFormPerms>;
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
      auditor: ac.auditor,
      departments: (ac.departments as Record<string, boolean | AccessTierKey>) ?? {},
      forms: (ac.forms as Record<string, AccessFormPerms>) ?? {},
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
        auditor: viewerOriginalAccess.auditor,
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

  it('saveUserAccess stores a tier per department and applies the action cascade', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        departments: { sales: 'L3', qc: 'L2' },
        forms: {
          so_create: perms({ edit: true }), // edit ⇒ view+entry+edit
          qc_submit: perms({ entry: true }), // entry ⇒ view+entry
          item_create: perms({ view: true }), // view only
          po_create: perms({ approve: true }), // approve ⇒ view+approve, NOT edit
        },
      },
      admin,
    );
    expect(saved.fullAccess).toBe(false);
    expect(saved.departments.sales).toBe('L3');
    expect(saved.departments.qc).toBe('L2');
    expect(saved.departments.design).toBeUndefined();
    expect(saved.forms.so_create).toEqual(perms({ view: true, entry: true, edit: true }));
    expect(saved.forms.qc_submit).toEqual(perms({ view: true, entry: true }));
    expect(saved.forms.item_create).toEqual(perms({ view: true }));
    // Approve must NOT drag entry/edit along — that split is the whole
    // point of an L4 Approver.
    expect(saved.forms.po_create).toEqual(perms({ view: true, approve: true }));
  });

  it('saveUserAccess accepts the pre-0100 boolean dept shape as L1', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        departments: { sales: true },
        forms: {},
      },
      admin,
    );
    expect(saved.departments.sales).toBe('L1');
  });

  it('saveUserAccess drops unknown dept/form keys silently', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        departments: { sales: 'L3', fictional_dept: 'L3' },
        forms: {
          so_create: perms({ view: true }),
          fictional_form_key: perms({ view: true }),
        },
      },
      admin,
    );
    expect(saved.departments.fictional_dept).toBeUndefined();
    expect(saved.forms.fictional_form_key).toBeUndefined();
    expect(saved.departments.sales).toBe('L3');
    expect(saved.forms.so_create).toBeDefined();
  });

  it('saveUserAccess fullAccess=true overrides cleanly and clears auditor', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      { fullAccess: true, auditor: true, departments: {}, forms: {} },
      admin,
    );
    expect(saved.fullAccess).toBe(true);
    // L6 and L7 are mutually exclusive — Super Admin wins.
    expect(saved.auditor).toBe(false);
    expect(saved.departments).toEqual({});
    expect(saved.forms).toEqual({});
  });

  it('saveUserAccess stores the L7 auditor flag on its own', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      { fullAccess: false, auditor: true, departments: {}, forms: {} },
      admin,
    );
    expect(saved.auditor).toBe(true);
    expect(saved.fullAccess).toBe(false);
  });

  it('saveUserAccess rejects non-admin', async () => {
    await expect(
      service.saveUserAccess(
        viewer.id,
        { fullAccess: false, auditor: false, departments: {}, forms: {} },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('saveUserAccess emits ACCESS activity log row naming the tiers', async () => {
    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        departments: { sales: 'L3' },
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
    expect(rows.some((r) => (r.detail ?? '').includes('Sales L3'))).toBe(true);
  });

  it('getMyAccess returns caller-effective access (post-cascade)', async () => {
    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        departments: { sales: 'L3' },
        // Edit-only on purchase line should cascade to view+entry+edit at read time.
        forms: { po_create: perms({ edit: true }) },
      },
      admin,
    );
    const my = await service.getMyAccess(viewer);
    expect(my.fullAccess).toBe(false);
    expect(my.departments.sales).toBe('L3');
    expect(my.forms.po_create).toEqual(perms({ view: true, entry: true, edit: true }));
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
    expect(my.auditor).toBe(false);
    expect(my.departments).toEqual({});
    expect(my.forms).toEqual({});
  });
});
