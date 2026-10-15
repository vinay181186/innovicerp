// ADR-232 (owner, 2026-10-15): deleting a Design Work Log entry needs L6 Super
// Admin — the Edit + Approve pair (L5) no longer grants it.
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

describe('deleteDesignWorkLogEntry — Super Admin only (ADR-232)', () => {
  it('Design L5 Department Admin is refused', async () => {
    const user = asAccess(admin, { departments: { design: 'L5' } }, 'manager');
    await expect(service.deleteDesignWorkLogEntry(UNKNOWN_ID, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.deleteDesignWorkLogEntry(UNKNOWN_ID, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('Super Admin passes the gate', async () => {
    await expect(service.deleteDesignWorkLogEntry(UNKNOWN_ID, admin)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
