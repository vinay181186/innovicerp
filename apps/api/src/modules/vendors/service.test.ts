import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users, vendors } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const TEST_PREFIX = 'T018-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error('Seed admin missing — run pnpm --filter api seed');
  }
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

afterAll(async () => {
  await db.delete(vendors).where(like(vendors.code, `${TEST_PREFIX}%`));
});

// ADR-244 / ADR-246 — a vendor save needs a GST Category, and a GSTIN unless
// Unregistered / Overseas. These fixtures are not about GST, so they take the
// simplest valid answer: Unregistered, State Gujarat (24).
const NO_GSTIN = { gstCategory: 'unregistered', stateCode: '24' } as const;

describe('vendors service', () => {
  it('createVendor inserts a row with audit columns + soft-delete null', async () => {
    const code = `${TEST_PREFIX}A1`;
    const v = await service.createVendor(
      { code, name: 'Alpha Suppliers', isActive: true, ...NO_GSTIN },
      admin,
    );
    expect(v.code).toBe(code);
    expect(v.companyId).toBe(admin.companyId);
    expect(v.createdBy).toBe(admin.id);
    expect(v.updatedBy).toBe(admin.id);
    expect(v.deletedAt).toBeNull();
    expect(v.isActive).toBe(true);
  });

  it('createVendor auto-generates distinct sequential VND- codes (bug 2)', async () => {
    const a = await service.createVendor(
      { name: 'Auto Vendor A', isActive: true, ...NO_GSTIN },
      admin,
    );
    const b = await service.createVendor(
      { name: 'Auto Vendor B', isActive: true, ...NO_GSTIN },
      admin,
    );
    expect(a.code).toMatch(/^VND-\d{3,}$/);
    expect(b.code).toMatch(/^VND-\d{3,}$/);
    expect(a.code).not.toBe(b.code);
    const na = Number(a.code.replace(/\D/g, ''));
    const nb = Number(b.code.replace(/\D/g, ''));
    expect(nb).toBe(na + 1);
    // Generated codes don't carry TEST_PREFIX, so clean up explicitly.
    await db.delete(vendors).where(eq(vendors.id, a.id));
    await db.delete(vendors).where(eq(vendors.id, b.id));
  });

  it('createVendor rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createVendor({ code, name: 'First', isActive: true, ...NO_GSTIN }, admin);
    await expect(
      service.createVendor({ code, name: 'Second', isActive: true, ...NO_GSTIN }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createVendor preserves materialsSupplied + rating', async () => {
    const code = `${TEST_PREFIX}MAT`;
    const v = await service.createVendor(
      {
        code,
        name: 'Steel Co',
        materialsSupplied: 'EN8, EN24, EN31',
        rating: 'A',
        isActive: true,
        ...NO_GSTIN,
      },
      admin,
    );
    expect(v.materialsSupplied).toBe('EN8, EN24, EN31');
    expect(v.rating).toBe('A');
  });

  it('getVendor throws NotFoundError for unknown id', async () => {
    await expect(
      service.getVendor('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listVendors filters by search', async () => {
    await service.createVendor(
      { code: `${TEST_PREFIX}SEARCH-A`, name: 'Searchable A', isActive: true, ...NO_GSTIN },
      admin,
    );
    await service.createVendor(
      { code: `${TEST_PREFIX}SEARCH-B`, name: 'Other B', isActive: true, ...NO_GSTIN },
      admin,
    );
    const result = await service.listVendors({ search: 'Searchable', limit: 50, offset: 0 }, admin);
    expect(result.vendors.some((v) => v.code === `${TEST_PREFIX}SEARCH-A`)).toBe(true);
    expect(result.vendors.every((v) => v.companyId === admin.companyId)).toBe(true);
  });

  it('updateVendor changes fields', async () => {
    const created = await service.createVendor(
      { code: `${TEST_PREFIX}U1`, name: 'Original', isActive: true, ...NO_GSTIN },
      admin,
    );
    const updated = await service.updateVendor(created.id, { name: 'Renamed', rating: 'B' }, admin);
    expect(updated.name).toBe('Renamed');
    expect(updated.rating).toBe('B');
    expect(updated.code).toBe(`${TEST_PREFIX}U1`);
  });

  it('softDeleteVendor sets deletedAt; row no longer visible', async () => {
    const created = await service.createVendor(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', isActive: true, ...NO_GSTIN },
      admin,
    );
    await service.softDeleteVendor(created.id, 'test cleanup', admin);
    await expect(service.getVendor(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ADR-232 (owner, 2026-10-15): deleting any record needs L6 Super Admin. No
// department tier — not even L5 Department Admin — and no page tick grants it.
describe('softDeleteVendor — Super Admin only (ADR-232)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

  it('L5 Department Admin cannot delete Vendors — AuthorizationError', async () => {
    const l5 = asAccess(admin, { departments: { purchase: 'L5' } }, 'manager');
    await expect(service.softDeleteVendor(UNKNOWN_ID, 'test', l5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor cannot delete Vendors — AuthorizationError', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { purchase: 'L5' } });
    await expect(service.softDeleteVendor(UNKNOWN_ID, 'test', auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the delete gate (unknown id → NotFoundError, not refused)', async () => {
    await expect(service.softDeleteVendor(UNKNOWN_ID, 'test', admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
