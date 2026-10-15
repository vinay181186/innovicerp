// ADR-232 (owner, 2026-10-15): uploading a JWSO file follows the JWSO Master
// Entry tick (it used to refuse only role 'viewer'); deleting one — which had
// no gate at all — needs L6 Super Admin.
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
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

// An unknown JWSO: a gate pass ends in NotFoundError, nothing is inserted.
const doc = {
  jobWorkOrderId: UNKNOWN_ID,
  category: 'po-docs' as const,
  fileName: 'adr232.pdf',
  storagePath: 'company/jw-docs/adr232.pdf',
};

describe('jwso-documents — ticks decide (ADR-232)', () => {
  it('Sales L2 with role operator passes the upload gate', async () => {
    const user = asAccess(admin, { departments: { sales: 'L2' } }, 'operator');
    await expect(service.createJwDocument(doc, user)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Sales L1 (no Entry tick) is refused', async () => {
    const user = asAccess(admin, { departments: { sales: 'L1' } }, 'manager');
    await expect(service.createJwDocument(doc, user)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.createJwDocument(doc, user)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('delete: Sales L5 Department Admin is refused (Super Admin only)', async () => {
    const user = asAccess(admin, { departments: { sales: 'L5' } }, 'manager');
    await expect(service.deleteJwDocument(UNKNOWN_ID, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('delete: Super Admin passes the gate', async () => {
    await expect(service.deleteJwDocument(UNKNOWN_ID, admin)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
