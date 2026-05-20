// User management service tests. Use seed admin + seed viewer; capture +
// restore the viewer's row in afterAll since we can't blow away auth.users
// rows (they're owned by Supabase Auth).

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';

let admin: AuthContext;
let viewer: AuthContext;
let viewerOriginal: { fullName: string | null; phone: string | null; role: string; isActive: boolean };

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
  };
});

afterAll(async () => {
  // Restore the viewer row exactly. The deletedAt clear handles the
  // softDelete test's residue. updatedBy must reference a real user.
  await db
    .update(users)
    .set({
      fullName: viewerOriginal.fullName,
      phone: viewerOriginal.phone,
      role: viewerOriginal.role as never,
      isActive: viewerOriginal.isActive,
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

  it('softDeleteUser sets deletedAt; row no longer visible', async () => {
    await service.softDeleteUser(viewer.id, admin);
    await expect(service.getUser(viewer.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    // afterAll restores deletedAt=null
  });

  it('softDeleteUser rejects self-delete', async () => {
    await expect(service.softDeleteUser(admin.id, admin)).rejects.toBeInstanceOf(ValidationError);
  });
});
