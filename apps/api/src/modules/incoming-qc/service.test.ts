// ADR-232 (owner, 2026-10-15) gate tests for Incoming QC. NOTE: like every api
// test here this reads the database DATABASE_URL points at — written, not run
// (house rules). It writes nothing: every call is refused or stops at "not found".
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
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

// The Incoming QC tick alone decides. A Quality-only inspector's derived role
// is 'qc', which the old manager/admin role check refused.
describe('submitIncomingQc — ADR-232 Access Control ticks alone decide', () => {
  const input = { acceptedQty: 1, rejectedQty: 0, qcInspectedByName: 'Gate Test' };

  it('QC L2 whose role is qc passes the gate (unknown line → not refused)', async () => {
    const qcL2 = asAccess(admin, { departments: { qc: 'L2' } }, 'qc');
    await expect(service.submitIncomingQc(UNKNOWN_ID, input, qcL2)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('a Store L5 manager without the Incoming QC tick → AuthorizationError', async () => {
    const storeL5 = asAccess(admin, { departments: { store: 'L5' } }, 'manager');
    await expect(service.submitIncomingQc(UNKNOWN_ID, input, storeL5)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor → AuthorizationError', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, departments: { qc: 'L5' } });
    await expect(service.submitIncomingQc(UNKNOWN_ID, input, auditor)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
