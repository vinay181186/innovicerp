import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users, vendors } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
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

describe('vendors service', () => {
  it('createVendor inserts a row with audit columns + soft-delete null', async () => {
    const code = `${TEST_PREFIX}A1`;
    const v = await service.createVendor({ code, name: 'Alpha Suppliers', isActive: true }, admin);
    expect(v.code).toBe(code);
    expect(v.companyId).toBe(admin.companyId);
    expect(v.createdBy).toBe(admin.id);
    expect(v.updatedBy).toBe(admin.id);
    expect(v.deletedAt).toBeNull();
    expect(v.isActive).toBe(true);
  });

  it('createVendor auto-generates distinct sequential VND- codes (bug 2)', async () => {
    const a = await service.createVendor({ name: 'Auto Vendor A', isActive: true }, admin);
    const b = await service.createVendor({ name: 'Auto Vendor B', isActive: true }, admin);
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
    await service.createVendor({ code, name: 'First', isActive: true }, admin);
    await expect(
      service.createVendor({ code, name: 'Second', isActive: true }, admin),
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
      { code: `${TEST_PREFIX}SEARCH-A`, name: 'Searchable A', isActive: true },
      admin,
    );
    await service.createVendor(
      { code: `${TEST_PREFIX}SEARCH-B`, name: 'Other B', isActive: true },
      admin,
    );
    const result = await service.listVendors({ search: 'Searchable', limit: 50, offset: 0 }, admin);
    expect(result.vendors.some((v) => v.code === `${TEST_PREFIX}SEARCH-A`)).toBe(true);
    expect(result.vendors.every((v) => v.companyId === admin.companyId)).toBe(true);
  });

  it('updateVendor changes fields', async () => {
    const created = await service.createVendor(
      { code: `${TEST_PREFIX}U1`, name: 'Original', isActive: true },
      admin,
    );
    const updated = await service.updateVendor(created.id, { name: 'Renamed', rating: 'B' }, admin);
    expect(updated.name).toBe('Renamed');
    expect(updated.rating).toBe('B');
    expect(updated.code).toBe(`${TEST_PREFIX}U1`);
  });

  it('softDeleteVendor sets deletedAt; row no longer visible', async () => {
    const created = await service.createVendor(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', isActive: true },
      admin,
    );
    await service.softDeleteVendor(created.id, admin);
    await expect(service.getVendor(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
