import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { machines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T020-';
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
  await db.delete(machines).where(like(machines.code, `${TEST_PREFIX}%`));
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

  it('createMachine preserves capacityPerShift + machineType', async () => {
    const code = `${TEST_PREFIX}CAP`;
    const m = await service.createMachine(
      {
        code,
        name: 'CNC',
        machineType: 'CNC',
        capacityPerShift: 8,
        shiftsPerDay: 2,
        status: 'Running',
      },
      admin,
    );
    expect(m.machineType).toBe('CNC');
    expect(m.capacityPerShift).toBe(8);
    expect(m.shiftsPerDay).toBe(2);
    expect(m.status).toBe('Running');
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
