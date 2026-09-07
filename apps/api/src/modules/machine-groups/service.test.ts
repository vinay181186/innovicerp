import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { machineGroups, machines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T116-';
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
  // Machines first: they hold the FK to the group.
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
  await db.delete(machineGroups).where(like(machineGroups.code, `${TEST_PREFIX}%`));
});

describe('machine groups service', () => {
  it('createMachineGroup inserts a row with audit columns', async () => {
    const code = `${TEST_PREFIX}VMC`;
    const g = await service.createMachineGroup(
      { code, description: 'Vertical machining centres', isActive: true },
      admin,
    );
    expect(g.code).toBe(code);
    expect(g.companyId).toBe(admin.companyId);
    expect(g.isActive).toBe(true);
    expect(g.description).toBe('Vertical machining centres');
  });

  it('createMachineGroup rejects a duplicate code in the same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createMachineGroup({ code, isActive: true }, admin);
    await expect(
      service.createMachineGroup({ code, isActive: true }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('getMachineGroup throws NotFoundError for an unknown id', async () => {
    await expect(
      service.getMachineGroup('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listMachineGroups filters by search and by isActive', async () => {
    await service.createMachineGroup({ code: `${TEST_PREFIX}LG-A`, isActive: true }, admin);
    await service.createMachineGroup({ code: `${TEST_PREFIX}LG-B`, isActive: false }, admin);
    const result = await service.listMachineGroups(
      { search: `${TEST_PREFIX}LG`, isActive: true, limit: 50, offset: 0 },
      admin,
    );
    expect(result.groups.some((g) => g.code === `${TEST_PREFIX}LG-A`)).toBe(true);
    expect(result.groups.every((g) => g.isActive)).toBe(true);
  });

  it('updateMachineGroup changes description and isActive', async () => {
    const created = await service.createMachineGroup(
      { code: `${TEST_PREFIX}U1`, description: 'before', isActive: true },
      admin,
    );
    const updated = await service.updateMachineGroup(
      created.id,
      { description: 'after', isActive: false },
      admin,
    );
    expect(updated.description).toBe('after');
    expect(updated.isActive).toBe(false);
    // code is permanent — the update schema has no code field at all.
    expect(updated.code).toBe(`${TEST_PREFIX}U1`);
  });

  it('softDeleteMachineGroup sets deletedAt; row no longer visible', async () => {
    const created = await service.createMachineGroup(
      { code: `${TEST_PREFIX}D1`, isActive: true },
      admin,
    );
    await service.softDeleteMachineGroup(created.id, admin);
    await expect(service.getMachineGroup(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('softDeleteMachineGroup refuses while a live machine still uses the group', async () => {
    const created = await service.createMachineGroup(
      { code: `${TEST_PREFIX}INUSE`, isActive: true },
      admin,
    );
    await db.insert(machines).values({
      companyId: admin.companyId!,
      code: `${TEST_PREFIX}M1`,
      name: 'Uses the group',
      machineType: `${TEST_PREFIX}INUSE`,
      machineGroupId: created.id,
      createdBy: admin.id,
      updatedBy: admin.id,
    });
    await expect(service.softDeleteMachineGroup(created.id, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
