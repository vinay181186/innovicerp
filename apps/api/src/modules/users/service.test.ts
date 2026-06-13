// User management service tests. Use seed admin + seed viewer; capture +
// restore the viewer's row in afterAll since we can't blow away auth.users
// rows (they're owned by Supabase Auth).

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { supabaseAdmin } from '../../lib/supabase-admin';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';
// Disposable account for the createUser happy-path. Cleaned up before + after.
const ADD_TEST_EMAIL = 'add-test-optiona@innovic.test';

// Remove a leftover auth.users + public.users row for an email (idempotent).
// Used so a re-run after a crashed test doesn't trip the duplicate-email guard.
async function purgeByEmail(email: string): Promise<void> {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) await supabaseAdmin.auth.admin.deleteUser(found.id);
  // FK users.id -> auth.users.id is ON DELETE CASCADE, but delete defensively
  // in case the cascade isn't present in this environment.
  await db.delete(users).where(eq(users.email, email));
}

let admin: AuthContext;
let viewer: AuthContext;
let viewerOriginal: {
  fullName: string | null;
  phone: string | null;
  role: string;
  isActive: boolean;
  approvalLimit: string | null;
};

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
  viewerOriginal = {
    fullName: v.fullName,
    phone: v.phone,
    role: v.role,
    isActive: v.isActive,
    approvalLimit: v.approvalLimit,
  };

  await purgeByEmail(ADD_TEST_EMAIL);
});

afterAll(async () => {
  await purgeByEmail(ADD_TEST_EMAIL);

  // Restore the viewer row exactly. The deletedAt clear handles the
  // softDelete test's residue. updatedBy must reference a real user.
  await db
    .update(users)
    .set({
      fullName: viewerOriginal.fullName,
      phone: viewerOriginal.phone,
      role: viewerOriginal.role as never,
      isActive: viewerOriginal.isActive,
      approvalLimit: viewerOriginal.approvalLimit,
      deletedAt: null,
      updatedBy: admin.id,
    })
    .where(eq(users.email, VIEWER_EMAIL));
});

describe('users service', () => {
  it('listUsers returns all users in company; admin-only', async () => {
    const result = await service.listUsers({ limit: 50, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.items.some((u) => u.email === ADMIN_EMAIL)).toBe(true);
    expect(result.items.some((u) => u.email === VIEWER_EMAIL)).toBe(true);
  });

  it('listUsers rejects non-admin caller', async () => {
    await expect(service.listUsers({ limit: 50, offset: 0 }, viewer)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('listUsers filters by search', async () => {
    const result = await service.listUsers(
      { search: 'viewer', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.some((u) => u.email === VIEWER_EMAIL)).toBe(true);
  });

  it('listUsers filters by role', async () => {
    const result = await service.listUsers(
      { role: 'admin', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.every((u) => u.role === 'admin')).toBe(true);
  });

  it('createUser is admin-only', async () => {
    await expect(
      service.createUser(
        { email: ADD_TEST_EMAIL, password: 'password123', fullName: 'X', role: 'viewer', isActive: true },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('createUser rejects a duplicate email with ConflictError', async () => {
    await expect(
      service.createUser(
        { email: ADMIN_EMAIL, password: 'password123', fullName: 'Dup', role: 'viewer', isActive: true },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createUser provisions an auth account + promotes the row into the company', async () => {
    const created = await service.createUser(
      {
        email: ADD_TEST_EMAIL,
        password: 'password123',
        fullName: 'Add Test',
        role: 'operator',
        phone: '+91-9999999999',
        approvalLimit: 50000,
        isActive: true,
      },
      admin,
    );
    expect(created.email).toBe(ADD_TEST_EMAIL);
    expect(created.fullName).toBe('Add Test');
    expect(created.role).toBe('operator');
    expect(created.companyId).toBe(admin.companyId);
    expect(created.isActive).toBe(true);
    expect(created.approvalLimit).toBe('50000.00');
    // Now visible in the admin's company-scoped list.
    const list = await service.listUsers({ search: ADD_TEST_EMAIL, limit: 50, offset: 0 }, admin);
    expect(list.items.some((u) => u.id === created.id)).toBe(true);
  });

  it('getUser throws NotFoundError for unknown id', async () => {
    await expect(
      service.getUser('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateUser changes fullName + phone', async () => {
    const updated = await service.updateUser(
      viewer.id,
      { fullName: 'TestViewer Renamed', phone: '+91-0000000000' },
      admin,
    );
    expect(updated.fullName).toBe('TestViewer Renamed');
    expect(updated.phone).toBe('+91-0000000000');
  });

  it('updateUser changes role', async () => {
    const updated = await service.updateUser(viewer.id, { role: 'operator' }, admin);
    expect(updated.role).toBe('operator');
    // restore so other tests aren't surprised
    await service.updateUser(viewer.id, { role: 'viewer' }, admin);
  });

  it('updateUser rejects self-demotion', async () => {
    await expect(
      service.updateUser(admin.id, { role: 'manager' }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateUser rejects self-deactivation', async () => {
    await expect(
      service.updateUser(admin.id, { isActive: false }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('updateUser blocked for non-admin caller', async () => {
    await expect(
      service.updateUser(viewer.id, { fullName: 'Hi' }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('setUserPassword blocked for non-admin caller', async () => {
    await expect(
      service.setUserPassword(viewer.id, { password: 'longenough123' }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('setUserPassword throws NotFoundError for unknown id (no Auth call)', async () => {
    await expect(
      service.setUserPassword('00000000-0000-0000-0000-000000000000', { password: 'longenough123' }, admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateUser sets and clears approvalLimit (ADR-038)', async () => {
    const set = await service.updateUser(viewer.id, { approvalLimit: 75000 }, admin);
    // numeric column → string with 2dp
    expect(set.approvalLimit).toBe('75000.00');
    const cleared = await service.updateUser(viewer.id, { approvalLimit: null }, admin);
    expect(cleared.approvalLimit).toBeNull();
  });

  it('softDeleteUser sets deletedAt; row no longer visible', async () => {
    await service.softDeleteUser(viewer.id, admin);
    await expect(service.getUser(viewer.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    // afterAll restores deletedAt=null
  });

  it('softDeleteUser rejects self-delete', async () => {
    await expect(service.softDeleteUser(admin.id, admin)).rejects.toBeInstanceOf(ValidationError);
  });
});
