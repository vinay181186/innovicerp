import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T009-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) {
    throw new Error(
      `Seed admin missing or has no company assignment. Run pnpm --filter api seed first.`,
    );
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
  // Hard-delete every test item so reruns are clean.
  // postgres-role connection bypasses RLS.
  await db.delete(items).where(like(items.code, `${TEST_PREFIX}%`));
});

describe('items service', () => {
  it('createItem inserts a row with audit columns + soft-delete null', async () => {
    const code = `${TEST_PREFIX}A1`;
    const item = await service.createItem(
      { code, name: 'Alpha', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    expect(item.code).toBe(code);
    expect(item.companyId).toBe(admin.companyId);
    expect(item.createdBy).toBe(admin.id);
    expect(item.updatedBy).toBe(admin.id);
    expect(item.deletedAt).toBeNull();
    expect(item.uom).toBe('NOS');
    expect(item.itemType).toBe('component');
  });

  it('createItem rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createItem(
      { code, name: 'First', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    await expect(
      service.createItem(
        { code, name: 'Second', revision: 'A', uom: 'NOS', itemType: 'component' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('getItem returns the row by id', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createItem(
      { code, name: 'Get Me', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    const fetched = await service.getItem(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.code).toBe(code);
  });

  it('getItem throws NotFoundError for unknown id', async () => {
    await expect(
      service.getItem('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listItems filters by search and stays company-scoped', async () => {
    const code = `${TEST_PREFIX}SRCH-X`;
    await service.createItem(
      { code, name: 'Searchable Widget', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    const result = await service.listItems({ search: 'SRCH-X', limit: 50, offset: 0 }, admin);
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    expect(result.items.every((i) => i.companyId === admin.companyId)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('updateItem changes fields and bumps updatedBy', async () => {
    const code = `${TEST_PREFIX}U1`;
    const created = await service.createItem(
      { code, name: 'Before', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    const updated = await service.updateItem(created.id, { name: 'After', revision: 'B' }, admin);
    expect(updated.name).toBe('After');
    expect(updated.revision).toBe('B');
    expect(updated.updatedBy).toBe(admin.id);
  });

  it('softDeleteItem sets deletedAt; row no longer visible to list/get', async () => {
    const code = `${TEST_PREFIX}D1`;
    const created = await service.createItem(
      { code, name: 'To Delete', revision: 'A', uom: 'NOS', itemType: 'component' },
      admin,
    );
    await service.softDeleteItem(created.id, admin);
    await expect(service.getItem(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws AuthorizationError when user has no company assignment', async () => {
    const noCompanyUser: AuthContext = { ...admin, companyId: null };
    await expect(
      service.createItem(
        {
          code: `${TEST_PREFIX}NOC`,
          name: 'No Company',
          revision: 'A',
          uom: 'NOS',
          itemType: 'component',
        },
        noCompanyUser,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
