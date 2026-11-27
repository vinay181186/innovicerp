// Access Control service tests. Uses seed admin + seed viewer.
//
// Cleanup discipline per feedback_test_activity_log_cleanup: scope removes
// to the target user (viewer) only, never entity-wide.

import type { AccessFormPerms, AccessTierKey } from '@innovic/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { activityLog, userAccess, users } from '../../db/schema';
import { type AuthContext, openRequestScope } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

// Shorthand for the perms literal the tests pass in.
const perms = (p: Partial<AccessFormPerms>): AccessFormPerms => ({
  view: false,
  entry: false,
  advance: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  advanceOff: false,
  editOff: false,
  approveOff: false,
  ...p,
});

let admin: AuthContext;
let viewer: AuthContext;
// saveUserAccess derives users.role from the access it saves (ADR-136), so the
// suite has to restore the role as well as the matrix row.
let viewerOriginalRole: string | null = null;
let viewerOriginalAccess: {
  fullAccess: boolean;
  auditor: boolean;
  drawingDownload: boolean;
  drawingPrint: boolean;
  drawingRelease: boolean;
  undoChain: boolean;
  mainDept: string | null;
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
  viewerOriginalRole = v.role;
  const ac = acRows[0];
  if (ac) {
    viewerOriginalAccess = {
      fullAccess: ac.fullAccess,
      auditor: ac.auditor,
      drawingDownload: ac.drawingDownload,
      drawingPrint: ac.drawingPrint,
      drawingRelease: ac.drawingRelease,
      undoChain: ac.undoChain,
      mainDept: ac.mainDept,
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
        drawingDownload: viewerOriginalAccess.drawingDownload,
        drawingPrint: viewerOriginalAccess.drawingPrint,
        drawingRelease: viewerOriginalAccess.drawingRelease,
        undoChain: viewerOriginalAccess.undoChain,
        mainDept: viewerOriginalAccess.mainDept,
        departments: viewerOriginalAccess.departments,
        forms: viewerOriginalAccess.forms,
        updatedBy: admin.id,
      })
      .where(eq(userAccess.userId, viewer.id));
  }
  if (viewerOriginalRole) {
    await db
      .update(users)
      .set({ role: viewerOriginalRole as typeof users.$inferSelect.role, updatedBy: admin.id })
      .where(eq(users.id, viewer.id));
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
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: { sales: 'L3', qc: 'L2' },
        forms: {
          so_create: perms({ edit: true }), // edit ⇒ view+entry+advance+edit
          qc_submit: perms({ entry: true }), // entry ⇒ view+entry, NOT advance (ADR-231)
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
    expect(saved.forms.so_create).toEqual(
      perms({ view: true, entry: true, advance: true, edit: true }),
    );
    expect(saved.forms.qc_submit).toEqual(perms({ view: true, entry: true }));
    expect(saved.forms.item_create).toEqual(perms({ view: true }));
    // Approve must NOT drag entry/edit along — that split is the whole
    // point of an L4 Approver.
    expect(saved.forms.po_create).toEqual(perms({ view: true, approve: true }));
  });

  it('ADR-231: an Advance tick saves as view+advance only — no entry, no edit', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: { sales: 'L1' },
        forms: { so_create: perms({ advance: true }) },
      },
      admin,
    );
    expect(saved.forms.so_create).toEqual(perms({ view: true, advance: true }));
  });

  it('saveUserAccess accepts the pre-0100 boolean dept shape as L1', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: { sales: true },
        forms: {},
      },
      admin,
    );
    expect(saved.departments.sales).toBe('L1');
  });

  // ── ADR-136: main department + derived role ───────────────────────
  const roleOf = async (): Promise<string> =>
    (await db.select({ role: users.role }).from(users).where(eq(users.id, viewer.id)).limit(1))[0]!
      .role;

  it('saveUserAccess stores the main department when the user holds a tier in it', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: 'design',
        confirmAdminChange: false,
        departments: { design: 'L3', sales: 'L1' },
        forms: {},
      },
      admin,
    );
    expect(saved.mainDept).toBe('design');
    // Design L3 is a write tier outside Quality, so the derived role is manager.
    expect(await roleOf()).toBe('manager');
  });

  it('saveUserAccess drops a main department the user holds no tier in', async () => {
    // The admin picked Design, then cleared the Design row by hand. Keeping
    // the stale value would leave the screen claiming a department the access
    // no longer backs.
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: 'design',
        confirmAdminChange: false,
        departments: { sales: 'L1' },
        forms: {},
      },
      admin,
    );
    expect(saved.mainDept).toBeNull();
  });

  it('derives the narrowest role that covers the access granted', async () => {
    const save = (departments: Record<string, 'L1' | 'L2' | 'L3' | 'L4' | 'L5'>) =>
      service.saveUserAccess(
        viewer.id,
        {
          fullAccess: false,
          auditor: false,
          drawingDownload: false,
          drawingPrint: false,
          drawingRelease: false,
          undoChain: false,
          mainDept: null,
          confirmAdminChange: false,
          departments,
          forms: {},
        },
        admin,
      );

    await save({ sales: 'L1', store: 'L1' });
    expect(await roleOf()).toBe('viewer');

    await save({ production: 'L2' });
    expect(await roleOf()).toBe('operator');

    // Quality is the only place they can write, so `qc` covers it — and `qc`
    // cannot write Sales or Purchase records, where `manager` could.
    await save({ qc: 'L3', sales: 'L1' });
    expect(await roleOf()).toBe('qc');

    await save({ qc: 'L3', purchase: 'L3' });
    expect(await roleOf()).toBe('manager');
  });

  it('derives admin only from Full Access, and viewer from Auditor', async () => {
    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: true,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: {},
        forms: {},
      },
      admin,
    );
    expect(await roleOf()).toBe('admin');

    await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: true,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: {},
        forms: {},
      },
      admin,
    );
    expect(await roleOf()).toBe('viewer');
  });

  it('saveUserAccess drops unknown dept/form keys silently', async () => {
    const saved = await service.saveUserAccess(
      viewer.id,
      {
        fullAccess: false,
        auditor: false,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
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
      {
        fullAccess: true,
        auditor: true,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: {},
        forms: {},
      },
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
      {
        fullAccess: false,
        auditor: true,
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: {},
        forms: {},
      },
      admin,
    );
    expect(saved.auditor).toBe(true);
    expect(saved.fullAccess).toBe(false);
  });

  it('saveUserAccess rejects non-admin', async () => {
    await expect(
      service.saveUserAccess(
        viewer.id,
        {
          fullAccess: false,
          auditor: false,
          drawingDownload: false,
          drawingPrint: false,
          drawingRelease: false,
          undoChain: false,
          mainDept: null,
          confirmAdminChange: false,
          departments: {},
          forms: {},
        },
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
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
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
        drawingDownload: false,
        drawingPrint: false,
        drawingRelease: false,
        undoChain: false,
        mainDept: null,
        confirmAdminChange: false,
        departments: { sales: 'L3' },
        // Edit-only on purchase line should cascade to view+entry+advance+edit at
        // read time (Edit ⇒ Advance, ADR-231).
        forms: { po_create: perms({ edit: true }) },
      },
      admin,
    );
    const my = await service.getMyAccess(viewer);
    expect(my.fullAccess).toBe(false);
    expect(my.departments.sales).toBe('L3');
    expect(my.forms.po_create).toEqual(
      perms({ view: true, entry: true, advance: true, edit: true }),
    );
  });

  it('ADR-229: one request reuses its read; the next request sees a right switched OFF', async () => {
    const grant = (departments: Record<string, AccessTierKey>) =>
      service.saveUserAccess(
        viewer.id,
        {
          fullAccess: false,
          auditor: false,
          drawingDownload: false,
          drawingPrint: false,
          drawingRelease: false,
          undoChain: false,
          mainDept: null,
          confirmAdminChange: false,
          departments,
          forms: {},
        },
        admin,
      );
    await grant({ sales: 'L3' });

    // A request, as the auth plugin builds it.
    const request1 = openRequestScope({ ...viewer });
    const first = await service.getMyAccess(request1);
    expect(first.departments.sales).toBe('L3');

    // The admin switches Sales OFF while request 1 is still running.
    await grant({});
    // Request 1 keeps the answer it read (accepted in ADR-229) ...
    expect(await service.getMyAccess(request1)).toBe(first);
    // ... and the very next request sees the change.
    const request2 = openRequestScope({ ...viewer });
    expect((await service.getMyAccess(request2)).departments.sales).toBeUndefined();
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
    expect(my.undoChain).toBe(false);
  });
});

// 0266 — "Undo chain" Special Right: only an L6 Super Admin may change it.
describe('access-control service — Undo chain', () => {
  // An admin by role whose own matrix is NOT Full Access, and an L6 one.
  // asAccess pre-fills the caller's per-request access (ADR-229/232).
  const nonL6Admin = () => asAccess(admin, { fullAccess: false }, 'admin');
  const l6Admin = () => asAccess(admin, { fullAccess: true }, 'admin');
  const input = (undoChain: boolean) => ({
    fullAccess: false,
    auditor: false,
    drawingDownload: false,
    drawingPrint: false,
    drawingRelease: false,
    undoChain,
    mainDept: null,
    confirmAdminChange: false,
    departments: { sales: 'L3' as const },
    forms: {},
  });
  const storedUndoChain = async (): Promise<boolean | undefined> =>
    (
      await db
        .select({ undoChain: userAccess.undoChain })
        .from(userAccess)
        .where(eq(userAccess.userId, viewer.id))
        .limit(1)
    )[0]?.undoChain;
  const undoChainLogRows = () =>
    db
      .select({ detail: activityLog.detail })
      .from(activityLog)
      .where(and(eq(activityLog.entity, 'Access Control'), eq(activityLog.refId, viewer.id)));

  it('start state: the viewer does not hold Undo chain', async () => {
    await service.saveUserAccess(viewer.id, input(false), l6Admin());
    expect(await storedUndoChain()).toBe(false);
  });

  it('refuses a non-L6 admin who changes Undo chain, before any write', async () => {
    const before = (
      await db
        .select({ updatedAt: userAccess.updatedAt })
        .from(userAccess)
        .where(eq(userAccess.userId, viewer.id))
        .limit(1)
    )[0]!.updatedAt;
    await expect(service.saveUserAccess(viewer.id, input(true), nonL6Admin())).rejects.toThrow(
      'Only a Super Admin can change Undo chain.',
    );
    await expect(
      service.saveUserAccess(viewer.id, input(true), nonL6Admin()),
    ).rejects.toBeInstanceOf(AuthorizationError);
    const after = (
      await db
        .select({ updatedAt: userAccess.updatedAt, undoChain: userAccess.undoChain })
        .from(userAccess)
        .where(eq(userAccess.userId, viewer.id))
        .limit(1)
    )[0]!;
    expect(after.undoChain).toBe(false);
    expect(after.updatedAt.getTime()).toBe(before.getTime());
  });

  it('lets a non-L6 admin save when Undo chain is unchanged', async () => {
    const saved = await service.saveUserAccess(viewer.id, input(false), nonL6Admin());
    expect(saved.undoChain).toBe(false);
    expect(saved.departments.sales).toBe('L3');
  });

  it('lets an L6 Super Admin give and take Undo chain, one extra log row each', async () => {
    const given = await service.saveUserAccess(viewer.id, input(true), l6Admin());
    expect(given.undoChain).toBe(true);
    expect(await storedUndoChain()).toBe(true);
    let rows = await undoChainLogRows();
    expect(rows.filter((r) => (r.detail ?? '').startsWith('Undo chain GIVEN to ')).length).toBe(1);
    expect(rows.some((r) => (r.detail ?? '').includes('; undo chain YES'))).toBe(true);

    const taken = await service.saveUserAccess(viewer.id, input(false), l6Admin());
    expect(taken.undoChain).toBe(false);
    rows = await undoChainLogRows();
    expect(rows.filter((r) => (r.detail ?? '').startsWith('Undo chain TAKEN from ')).length).toBe(
      1,
    );
  });

  it('an unchanged save writes no extra Undo chain log row', async () => {
    const count = async () =>
      (await undoChainLogRows()).filter((r) => (r.detail ?? '').startsWith('Undo chain ')).length;
    const n = await count();
    await service.saveUserAccess(viewer.id, input(false), l6Admin());
    expect(await count()).toBe(n);
  });

  it('a body without undoChain (old tab) keeps the stored value', async () => {
    await service.saveUserAccess(viewer.id, input(true), l6Admin());
    // The schema defaulted the missing field to false; the route says it was
    // not sent, so even a non-L6 admin's save goes through and keeps the tick.
    const saved = await service.saveUserAccess(viewer.id, input(false), nonL6Admin(), {
      undoChainSent: false,
    });
    expect(saved.undoChain).toBe(true);
    expect(await storedUndoChain()).toBe(true);
    // Put it back.
    await service.saveUserAccess(viewer.id, input(false), l6Admin());
    expect(await storedUndoChain()).toBe(false);
  });

  it('L6 Super Admin includes Undo chain: a non-L6 admin cannot give or remove L6', async () => {
    const asL6 = { ...input(false), fullAccess: true, confirmAdminChange: true };
    await expect(service.saveUserAccess(viewer.id, asL6, nonL6Admin())).rejects.toThrow(
      'Only a Super Admin can give or remove L6 Super Admin, because it includes Undo chain.',
    );
    expect(await storedUndoChain()).toBe(false);

    // An L6 admin can, and the right change is logged on its own line.
    await service.saveUserAccess(viewer.id, asL6, l6Admin());
    let rows = await undoChainLogRows();
    expect(
      rows.some(
        (r) =>
          (r.detail ?? '').endsWith('(through L6 Super Admin)') &&
          (r.detail ?? '').startsWith('Undo chain GIVEN to '),
      ),
    ).toBe(true);

    // Taking L6 away again is refused for the non-L6 admin too.
    await expect(
      service.saveUserAccess(
        viewer.id,
        { ...input(false), confirmAdminChange: true },
        nonL6Admin(),
      ),
    ).rejects.toThrow('Only a Super Admin can give or remove L6 Super Admin');
    await service.saveUserAccess(
      viewer.id,
      { ...input(false), confirmAdminChange: true },
      l6Admin(),
    );
    rows = await undoChainLogRows();
    expect(
      rows.some(
        (r) =>
          (r.detail ?? '').startsWith('Undo chain TAKEN from ') &&
          (r.detail ?? '').endsWith('(through L6 Super Admin)'),
      ),
    ).toBe(true);
  });

  it('listUserAccess and getUserAccess carry the stored undoChain', async () => {
    const list = await service.listUserAccess(l6Admin());
    expect(list.items.find((u) => u.userId === viewer.id)?.undoChain).toBe(false);
    const one = await service.getUserAccess(viewer.id, l6Admin());
    expect(one.undoChain).toBe(false);
  });
});
