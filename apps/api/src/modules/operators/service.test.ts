import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { operators, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T021-';
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
  await db.delete(operators).where(like(operators.code, `${TEST_PREFIX}%`));
});

describe('operators service', () => {
  it('createOperator inserts a row with audit columns + soft-delete null', async () => {
    const code = `${TEST_PREFIX}A1`;
    const o = await service.createOperator(
      { code, name: 'Ramesh K.', isActive: true },
      admin,
    );
    expect(o.code).toBe(code);
    expect(o.companyId).toBe(admin.companyId);
    expect(o.createdBy).toBe(admin.id);
    expect(o.updatedBy).toBe(admin.id);
    expect(o.deletedAt).toBeNull();
    expect(o.isActive).toBe(true);
    expect(o.userId).toBeNull();
  });

  it('createOperator rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createOperator({ code, name: 'First', isActive: true }, admin);
    await expect(
      service.createOperator({ code, name: 'Second', isActive: true }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createOperator preserves department + skills', async () => {
    const code = `${TEST_PREFIX}SK`;
    const o = await service.createOperator(
      {
        code,
        name: 'Skilled',
        department: 'CNC Turning',
        skills: 'CNC-01, L-01',
        isActive: true,
      },
      admin,
    );
    expect(o.department).toBe('CNC Turning');
    expect(o.skills).toBe('CNC-01, L-01');
  });

  it('getOperator throws NotFoundError for unknown id', async () => {
    await expect(
      service.getOperator('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listOperators filters by search across code, name, department', async () => {
    await service.createOperator(
      {
        code: `${TEST_PREFIX}LM-A`,
        name: 'Searchable A',
        department: 'Milling',
        isActive: true,
      },
      admin,
    );
    await service.createOperator(
      {
        code: `${TEST_PREFIX}LM-B`,
        name: 'Other B',
        department: 'Searchable Dept',
        isActive: true,
      },
      admin,
    );
    const result = await service.listOperators(
      { search: 'Searchable', limit: 50, offset: 0 },
      admin,
    );
    const codes = result.operators.map((o) => o.code);
    expect(codes).toContain(`${TEST_PREFIX}LM-A`);
    expect(codes).toContain(`${TEST_PREFIX}LM-B`);
  });

  it('updateOperator changes fields', async () => {
    const created = await service.createOperator(
      { code: `${TEST_PREFIX}U1`, name: 'Original', isActive: true },
      admin,
    );
    const updated = await service.updateOperator(
      created.id,
      { name: 'Renamed', department: 'New Dept', isActive: false },
      admin,
    );
    expect(updated.name).toBe('Renamed');
    expect(updated.department).toBe('New Dept');
    expect(updated.isActive).toBe(false);
    expect(updated.code).toBe(`${TEST_PREFIX}U1`);
  });

  it('softDeleteOperator sets deletedAt; row no longer visible', async () => {
    const created = await service.createOperator(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', isActive: true },
      admin,
    );
    await service.softDeleteOperator(created.id, admin);
    await expect(service.getOperator(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
