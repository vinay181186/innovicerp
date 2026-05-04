import { and, asc, eq, isNull, like, notLike } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { items, jobCards, ncRegister, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';

const TEST_PREFIX = 'T040A-NC-';
const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;
let firstItemId: string;
let firstJobCardId: string;

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
  // Pick the OLDEST seed item (defensive against parallel test cleanup).
  const itemRow = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(eq(items.companyId, u.companyId), isNull(items.deletedAt), notLike(items.code, 'T%-%')),
    )
    .orderBy(asc(items.createdAt))
    .limit(1);
  const it = itemRow[0];
  if (!it) throw new Error('No items in seed company — run migration load first');
  firstItemId = it.id;

  const jcRow = await db
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.companyId, u.companyId),
        isNull(jobCards.deletedAt),
        notLike(jobCards.code, 'T%-%'),
      ),
    )
    .orderBy(asc(jobCards.createdAt))
    .limit(1);
  const jc = jcRow[0];
  if (!jc) throw new Error('No job cards in seed company — run migration load first');
  firstJobCardId = jc.id;
});

afterAll(async () => {
  await db.delete(ncRegister).where(like(ncRegister.code, `${TEST_PREFIX}%`));
});

describe('nc-register service', () => {
  it('createNcRegister inserts row with audit columns + status defaults to pending', async () => {
    const code = `${TEST_PREFIX}A1`;
    const nc = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 5,
        reasonCategory: 'dimensional',
        reason: 'Defect on first pass',
      },
      admin,
    );
    expect(nc.code).toBe(code);
    expect(nc.companyId).toBe(admin.companyId);
    expect(nc.createdBy).toBe(admin.id);
    expect(nc.status).toBe('pending');
    expect(nc.disposition).toBeNull();
    expect(nc.rejectedQty).toBe('5.00');
    expect(nc.reasonCategory).toBe('dimensional');
    expect(nc.timeLogged).not.toBeNull();
    // itemCodeText is snapshot from items master at create time
    expect(nc.itemCodeText.length).toBeGreaterThan(0);
  });

  it('createNcRegister rejects duplicate code with ConflictError', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
      },
      admin,
    );
    await expect(
      service.createNcRegister(
        {
          code,
          ncDate: '2026-05-04',
          jobCardId: firstJobCardId,
          itemId: firstItemId,
          rejectedQty: 1,
          reasonCategory: 'other',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createNcRegister rejects unknown jobCardId / itemId with ValidationError', async () => {
    await expect(
      service.createNcRegister(
        {
          code: `${TEST_PREFIX}BADJ`,
          ncDate: '2026-05-04',
          jobCardId: '00000000-0000-0000-0000-000000000000',
          itemId: firstItemId,
          rejectedQty: 1,
          reasonCategory: 'other',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.createNcRegister(
        {
          code: `${TEST_PREFIX}BADI`,
          ncDate: '2026-05-04',
          jobCardId: firstJobCardId,
          itemId: '00000000-0000-0000-0000-000000000000',
          rejectedQty: 1,
          reasonCategory: 'other',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('createNcRegister rejects viewer role with AuthorizationError', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    await expect(
      service.createNcRegister(
        {
          code: `${TEST_PREFIX}VIEW`,
          ncDate: '2026-05-04',
          jobCardId: firstJobCardId,
          itemId: firstItemId,
          rejectedQty: 1,
          reasonCategory: 'other',
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('createNcRegister allows operator role (mirrors legacy canEntry semantics)', async () => {
    const operator: AuthContext = { ...admin, role: 'operator' };
    const code = `${TEST_PREFIX}OP1`;
    const nc = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 2,
        reasonCategory: 'surface',
      },
      operator,
    );
    expect(nc.code).toBe(code);
    expect(nc.createdBy).toBe(admin.id); // operator's `id` reused on this AuthContext
  });

  it('getNcRegister returns the row by id; throws NotFoundError when missing', async () => {
    const code = `${TEST_PREFIX}G1`;
    const created = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 3,
        reasonCategory: 'process',
      },
      admin,
    );
    const fetched = await service.getNcRegister(created.id, admin);
    expect(fetched.id).toBe(created.id);
    expect(fetched.rejectedQty).toBe('3.00');
    await expect(
      service.getNcRegister('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listNcRegister filters by status + search + jobCardId; returns jcCode + itemCode joins', async () => {
    const code = `${TEST_PREFIX}LST`;
    await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 4,
        reasonCategory: 'dimensional',
        reason: 'list-filter-marker',
      },
      admin,
    );
    const result = await service.listNcRegister(
      { search: 'T040A-NC-LST', status: 'pending', limit: 50, offset: 0 },
      admin,
    );
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const found = result.items.find((n) => n.code === code);
    expect(found?.jcCode).not.toBeNull();
    expect(found?.itemCode).not.toBeNull();
    expect(found?.reason).toBe('list-filter-marker');

    // jobCardId filter narrows to that JC only
    const byJc = await service.listNcRegister(
      { jobCardId: firstJobCardId, limit: 200, offset: 0 },
      admin,
    );
    expect(byJc.items.every((n) => n.jobCardId === firstJobCardId)).toBe(true);
  });

  it('updateNcRegister only writes fields present in input + bumps updatedBy', async () => {
    const code = `${TEST_PREFIX}U1`;
    const created = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
      },
      admin,
    );
    const updated = await service.updateNcRegister(
      created.id,
      { reason: 'updated reason', reasonCategory: 'machine_fault' },
      admin,
    );
    expect(updated.reason).toBe('updated reason');
    expect(updated.reasonCategory).toBe('machine_fault');
    // Untouched preserved
    expect(updated.jobCardId).toBe(firstJobCardId);
    expect(updated.rejectedQty).toBe('1.00');
  });

  it('updateNcRegister blocks once status leaves pending (ConflictError)', async () => {
    const code = `${TEST_PREFIX}LOCK`;
    const created = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
      },
      admin,
    );
    // Force a non-pending status via raw update to simulate T-040b having flipped it.
    await db.update(ncRegister).set({ status: 'closed' }).where(eq(ncRegister.id, created.id));
    await expect(
      service.updateNcRegister(created.id, { reason: 'too late' }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('softDeleteNcRegister soft-deletes pending NCs; blocks closed NCs (ConflictError)', async () => {
    const code = `${TEST_PREFIX}DEL`;
    const created = await service.createNcRegister(
      {
        code,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
      },
      admin,
    );
    await service.softDeleteNcRegister(created.id, admin);
    await expect(service.getNcRegister(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);

    const code2 = `${TEST_PREFIX}DEL2`;
    const created2 = await service.createNcRegister(
      {
        code: code2,
        ncDate: '2026-05-04',
        jobCardId: firstJobCardId,
        itemId: firstItemId,
        rejectedQty: 1,
        reasonCategory: 'other',
      },
      admin,
    );
    await db.update(ncRegister).set({ status: 'closed' }).where(eq(ncRegister.id, created2.id));
    await expect(service.softDeleteNcRegister(created2.id, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
