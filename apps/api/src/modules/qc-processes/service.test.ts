import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { qcProcesses, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const TEST_PREFIX = 'TQP-';
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
  await db.delete(qcProcesses).where(like(qcProcesses.code, `${TEST_PREFIX}%`));
});

describe('qcProcesses service', () => {
  it('createQcProcess inserts a row with audit columns', async () => {
    const code = `${TEST_PREFIX}DIM`;
    const p = await service.createQcProcess(
      { code, description: 'Dimensional check', defaultCycleTimeMin: 15, isActive: true },
      admin,
    );
    expect(p.code).toBe(code);
    expect(p.companyId).toBe(admin.companyId);
    expect(p.description).toBe('Dimensional check');
    expect(Number(p.defaultCycleTimeMin)).toBe(15);
    expect(p.isActive).toBe(true);
  });

  it('createQcProcess rejects duplicate code in same company', async () => {
    const code = `${TEST_PREFIX}DUP`;
    await service.createQcProcess(
      { code, defaultCycleTimeMin: 0, isActive: true },
      admin,
    );
    await expect(
      service.createQcProcess({ code, defaultCycleTimeMin: 0, isActive: true }, admin),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createQcProcess defaults are applied', async () => {
    const p = await service.createQcProcess(
      { code: `${TEST_PREFIX}DEF`, defaultCycleTimeMin: 0, isActive: true },
      admin,
    );
    expect(p.isActive).toBe(true);
    expect(Number(p.defaultCycleTimeMin)).toBe(0);
    expect(p.description).toBeNull();
  });

  it('getQcProcess throws NotFoundError for unknown id', async () => {
    await expect(
      service.getQcProcess('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listQcProcesses filters by search and isActive', async () => {
    await service.createQcProcess(
      {
        code: `${TEST_PREFIX}LM-A`,
        description: 'Searchable hardness',
        defaultCycleTimeMin: 5,
        isActive: true,
      },
      admin,
    );
    await service.createQcProcess(
      {
        code: `${TEST_PREFIX}LM-B`,
        description: 'Searchable cmm',
        defaultCycleTimeMin: 10,
        isActive: false,
      },
      admin,
    );
    const onlyActive = await service.listQcProcesses(
      { search: `${TEST_PREFIX}LM`, isActive: true, limit: 50, offset: 0 },
      admin,
    );
    expect(onlyActive.items.some((p) => p.code === `${TEST_PREFIX}LM-A`)).toBe(true);
    expect(onlyActive.items.every((p) => p.isActive)).toBe(true);
  });

  it('updateQcProcess changes description + cycle time + active', async () => {
    const created = await service.createQcProcess(
      { code: `${TEST_PREFIX}U1`, defaultCycleTimeMin: 5, isActive: true },
      admin,
    );
    const updated = await service.updateQcProcess(
      created.id,
      { description: 'Updated desc', defaultCycleTimeMin: 12, isActive: false },
      admin,
    );
    expect(updated.description).toBe('Updated desc');
    expect(Number(updated.defaultCycleTimeMin)).toBe(12);
    expect(updated.isActive).toBe(false);
  });

  it('softDeleteQcProcess sets deletedAt; row no longer visible', async () => {
    const created = await service.createQcProcess(
      { code: `${TEST_PREFIX}D1`, defaultCycleTimeMin: 0, isActive: true },
      admin,
    );
    await service.softDeleteQcProcess(created.id, admin);
    await expect(service.getQcProcess(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ADR-232 (owner, 2026-10-15): deleting any record needs L6 Super Admin. No
// department tier — not even L5 Department Admin — and no page tick grants it.
describe('softDeleteQcProcess — Super Admin only (ADR-232)', () => {
  const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

  it('L5 QC Department Admin cannot delete QC processes — AuthorizationError', async () => {
    const l5 = asAccess(admin, { departments: { qc: 'L5' } }, 'manager');
    await expect(service.softDeleteQcProcess(UNKNOWN_ID, l5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor cannot delete QC processes — AuthorizationError', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { qc: 'L5' } });
    await expect(service.softDeleteQcProcess(UNKNOWN_ID, auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the delete gate (unknown id → NotFoundError, not refused)', async () => {
    await expect(service.softDeleteQcProcess(UNKNOWN_ID, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
