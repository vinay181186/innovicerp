import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { clients, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T017-';
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
  await db.delete(clients).where(like(clients.code, `${TEST_PREFIX}%`));
});

describe('clients service', () => {
  it('createClient inserts a row with audit columns + soft-delete null', async () => {
    const code = `${TEST_PREFIX}A1`;
    const c = await service.createClient({ code, name: 'Alpha Industries', isActive: true }, admin);
    expect(c.code).toBe(code);
    expect(c.companyId).toBe(admin.companyId);
    expect(c.createdBy).toBe(admin.id);
    expect(c.updatedBy).toBe(admin.id);
    expect(c.deletedAt).toBeNull();
    expect(c.isActive).toBe(true);
  });

  it('createClient auto-generates the next CLI- code when omitted (bug 5.1)', async () => {
    const c = await service.createClient({ name: 'Auto Code Client', isActive: true }, admin);
    expect(c.code).toMatch(/^CLI-\d{3,}$/);
    // Generated codes don't carry TEST_PREFIX, so clean up explicitly.
    await db.delete(clients).where(eq(clients.id, c.id));
  });

  it('createClient rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createClient({ code, name: 'First', isActive: true }, admin);
    await expect(
      service.createClient({ code, name: 'Second', isActive: true }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('getClient returns the row by id', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createClient({ code, name: 'Get Me', isActive: true }, admin);
    const fetched = await service.getClient(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.code).toBe(code);
  });

  it('getClient throws NotFoundError for unknown id', async () => {
    await expect(
      service.getClient('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listClients filters by search and stays company-scoped', async () => {
    await service.createClient(
      { code: `${TEST_PREFIX}SEARCH-A`, name: 'Searchable A', isActive: true },
      admin,
    );
    await service.createClient(
      { code: `${TEST_PREFIX}SEARCH-B`, name: 'Other B', isActive: true },
      admin,
    );
    const result = await service.listClients({ search: 'Searchable', limit: 50, offset: 0 }, admin);
    expect(result.clients.some((c) => c.code === `${TEST_PREFIX}SEARCH-A`)).toBe(true);
    expect(result.clients.every((c) => c.companyId === admin.companyId)).toBe(true);
  });

  it('updateClient changes fields and bumps updatedBy', async () => {
    const created = await service.createClient(
      { code: `${TEST_PREFIX}U1`, name: 'Original', isActive: true },
      admin,
    );
    const updated = await service.updateClient(created.id, { name: 'Renamed' }, admin);
    expect(updated.name).toBe('Renamed');
    expect(updated.code).toBe(`${TEST_PREFIX}U1`);
    expect(updated.updatedBy).toBe(admin.id);
  });

  it('softDeleteClient sets deletedAt; row no longer visible to list/get', async () => {
    const created = await service.createClient(
      { code: `${TEST_PREFIX}D1`, name: 'Doomed', isActive: true },
      admin,
    );
    await service.softDeleteClient(created.id, admin);
    await expect(service.getClient(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
    const list = await service.listClients({ limit: 200, offset: 0 }, admin);
    expect(list.clients.find((c) => c.id === created.id)).toBeUndefined();
  });
});
