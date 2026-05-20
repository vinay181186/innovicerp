import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { costCenters, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'TCC-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
});

afterAll(async () => {
  await db.delete(costCenters).where(like(costCenters.code, `${TEST_PREFIX}%`));
});

describe('costCenters service', () => {
  it('createCostCenter inserts a row with audit columns', async () => {
    const code = `${TEST_PREFIX}001`;
    const cc = await service.createCostCenter(
      {
        code,
        name: 'Machine Shop Floor',
        department: 'Production',
        type: 'Manufacturing',
        description: 'Main CNC area',
        isActive: true,
      },
      admin,
    );
    expect(cc.code).toBe(code);
    expect(cc.companyId).toBe(admin.companyId);
    expect(cc.name).toBe('Machine Shop Floor');
    expect(cc.department).toBe('Production');
    expect(cc.type).toBe('Manufacturing');
    expect(cc.isActive).toBe(true);
  });

  it('createCostCenter rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createCostCenter({ code, name: 'First', isActive: true }, admin);
    await expect(
      service.createCostCenter({ code, name: 'Second', isActive: true }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createCostCenter applies defaults for optional fields', async () => {
    const cc = await service.createCostCenter(
      { code: `${TEST_PREFIX}DEF`, name: 'Defaults only', isActive: true },
      admin,
    );
    expect(cc.department).toBeNull();
    expect(cc.type).toBeNull();
    expect(cc.description).toBeNull();
    expect(cc.isActive).toBe(true);
  });

  it('getCostCenter throws NotFoundError for unknown id', async () => {
    await expect(
      service.getCostCenter('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listCostCenters filters by search + isActive + department + type', async () => {
    await service.createCostCenter(
      {
        code: `${TEST_PREFIX}LM-A`,
        name: 'Filter A',
        department: 'QC',
        type: 'Service',
        isActive: true,
      },
      admin,
    );
    await service.createCostCenter(
      {
        code: `${TEST_PREFIX}LM-B`,
        name: 'Filter B',
        department: 'QC',
        type: 'Overhead',
        isActive: false,
      },
      admin,
    );
    const qcActive = await service.listCostCenters(
      { search: `${TEST_PREFIX}LM`, isActive: true, department: 'QC', limit: 50, offset: 0 },
      admin,
    );
    expect(qcActive.items.some((c) => c.code === `${TEST_PREFIX}LM-A`)).toBe(true);
    expect(qcActive.items.every((c) => c.isActive && c.department === 'QC')).toBe(true);
  });

  it('updateCostCenter changes name + department + type + description + active', async () => {
    const created = await service.createCostCenter(
      { code: `${TEST_PREFIX}U1`, name: 'Original', isActive: true },
      admin,
    );
    const updated = await service.updateCostCenter(
      created.id,
      {
        name: 'Renamed',
        department: 'Admin',
        type: 'Overhead',
        description: 'Updated',
        isActive: false,
      },
      admin,
    );
    expect(updated.name).toBe('Renamed');
    expect(updated.department).toBe('Admin');
    expect(updated.type).toBe('Overhead');
    expect(updated.description).toBe('Updated');
    expect(updated.isActive).toBe(false);
  });

  it('softDeleteCostCenter sets deletedAt; row no longer visible', async () => {
    const created = await service.createCostCenter(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', isActive: true },
      admin,
    );
    await service.softDeleteCostCenter(created.id, admin);
    await expect(service.getCostCenter(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
