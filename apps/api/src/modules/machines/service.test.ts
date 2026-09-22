import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { machineGroups, machines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T020-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let testGroupId: string;

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

  // Machine Group master (migration 0116) — a separate field alongside the
  // free-text Type, so the machine tests need a group to point at.
  const g = await db
    .insert(machineGroups)
    .values({
      companyId: u.companyId,
      code: `${TEST_PREFIX}VMC`,
      createdBy: u.id,
      updatedBy: u.id,
    })
    .returning();
  testGroupId = g[0]!.id;
});

afterAll(async () => {
  // Machines first: they hold the FK to the group.
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
  await db.delete(machineGroups).where(like(machineGroups.code, `${TEST_PREFIX}%`));
});

describe('machines service', () => {
  it('createMachine inserts a row with audit columns', async () => {
    const code = `${TEST_PREFIX}A1`;
    const m = await service.createMachine(
      { code, name: 'CNC Alpha', shiftsPerDay: 1, status: 'Idle' },
      admin,
    );
    expect(m.code).toBe(code);
    expect(m.companyId).toBe(admin.companyId);
    expect(m.shiftsPerDay).toBe(1);
    expect(m.status).toBe('Idle');
  });

  it('createMachine rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createMachine({ code, name: 'First', shiftsPerDay: 1, status: 'Idle' }, admin);
    await expect(
      service.createMachine({ code, name: 'Second', shiftsPerDay: 1, status: 'Idle' }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createMachine preserves capacityPerShift, machineType, group and productCode', async () => {
    const code = `${TEST_PREFIX}CAP`;
    const m = await service.createMachine(
      {
        code,
        name: 'CNC',
        machineType: 'CNC',
        machineGroupId: testGroupId,
        productCode: 'PRD-1',
        capacityPerShift: 8,
        shiftsPerDay: 2,
        status: 'Running',
      },
      admin,
    );
    // Type stays free text; the group is a separate field alongside it.
    expect(m.machineType).toBe('CNC');
    expect(m.machineGroupId).toBe(testGroupId);
    expect(m.productCode).toBe('PRD-1');
    expect(m.capacityPerShift).toBe(8);
    expect(m.shiftsPerDay).toBe(2);
    expect(m.status).toBe('Running');
  });

  it('createMachine rejects an unknown machineGroupId', async () => {
    await expect(
      service.createMachine(
        {
          code: `${TEST_PREFIX}BADG`,
          name: 'No such group',
          machineGroupId: '00000000-0000-0000-0000-000000000000',
          shiftsPerDay: 1,
          status: 'Idle',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updateMachine sets the group without touching the free-text Type', async () => {
    const created = await service.createMachine(
      {
        code: `${TEST_PREFIX}UG`,
        name: 'Grouped',
        machineType: 'Typed by hand',
        shiftsPerDay: 1,
        status: 'Idle',
      },
      admin,
    );
    expect(created.machineGroupId).toBeNull();
    const updated = await service.updateMachine(created.id, { machineGroupId: testGroupId }, admin);
    expect(updated.machineGroupId).toBe(testGroupId);
    expect(updated.machineType).toBe('Typed by hand');
  });

  it('getMachine throws NotFoundError for unknown id', async () => {
    await expect(
      service.getMachine('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listMachines filters by search and by status', async () => {
    await service.createMachine(
      { code: `${TEST_PREFIX}LM-A`, name: 'Searchable A', shiftsPerDay: 1, status: 'Idle' },
      admin,
    );
    await service.createMachine(
      { code: `${TEST_PREFIX}LM-B`, name: 'Searchable B', shiftsPerDay: 1, status: 'Running' },
      admin,
    );
    const result = await service.listMachines(
      { search: 'Searchable', status: 'Running', limit: 50, offset: 0 },
      admin,
    );
    expect(result.machines.some((m) => m.code === `${TEST_PREFIX}LM-B`)).toBe(true);
    expect(result.machines.every((m) => m.status === 'Running')).toBe(true);
  });

  it('updateMachine changes fields', async () => {
    const created = await service.createMachine(
      { code: `${TEST_PREFIX}U1`, name: 'Original', shiftsPerDay: 1, status: 'Idle' },
      admin,
    );
    const updated = await service.updateMachine(
      created.id,
      { name: 'Renamed', status: 'Running' },
      admin,
    );
    expect(updated.name).toBe('Renamed');
    expect(updated.status).toBe('Running');
  });

  it('softDeleteMachine sets deletedAt; row no longer visible', async () => {
    const created = await service.createMachine(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', shiftsPerDay: 1, status: 'Idle' },
      admin,
    );
    await service.softDeleteMachine(created.id, admin);
    await expect(service.getMachine(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
