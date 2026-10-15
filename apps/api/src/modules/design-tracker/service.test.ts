// ADR-232 (owner, 2026-10-15): approving a design, or sending it back, follows
// the Design Tracker Approve tick — the admin/manager role check is gone.
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

describe('design-tracker approve / revise — ticks decide (ADR-232)', () => {
  it('Design L4 with role operator passes the approve gate', async () => {
    const user = asAccess(admin, { departments: { design: 'L4' } }, 'operator');
    await expect(service.approveDesign(UNKNOWN_ID, user)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Design L4 with role qc passes the revise gate', async () => {
    const user = asAccess(admin, { departments: { design: 'L4' } }, 'qc');
    await expect(service.reviseDesign(UNKNOWN_ID, {} as never, user)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Design L3 (no Approve tick) is refused, even as manager', async () => {
    const user = asAccess(admin, { departments: { design: 'L3' } }, 'manager');
    await expect(service.approveDesign(UNKNOWN_ID, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(service.reviseDesign(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.approveDesign(UNKNOWN_ID, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
