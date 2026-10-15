// ADR-232 (owner, 2026-10-15) delete-gate tests for qc-documents. NOTE: like every
// api test here this reads the database DATABASE_URL points at — written, not
// run (house rules). It writes nothing: every call is refused or stops at
// "not found".
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

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

// Deleting any record needs L6 Super Admin. No department tier — not even L5
// Department Admin — and no page tick grants it.
describe('deleteQcDocument — Super Admin only (ADR-232)', () => {
  it('L5 QC Department Admin cannot delete QC documents — AuthorizationError', async () => {
    const l5 = asAccess(admin, { departments: { qc: 'L5' } }, 'manager');
    await expect(service.deleteQcDocument(UNKNOWN_ID, l5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor cannot delete QC documents — AuthorizationError', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { qc: 'L5' } });
    await expect(service.deleteQcDocument(UNKNOWN_ID, auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the delete gate (unknown id → NotFoundError, not refused)', async () => {
    await expect(service.deleteQcDocument(UNKNOWN_ID, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});
