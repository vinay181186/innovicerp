// ADR-232 (owner, 2026-10-15): a person's own daily report needs no page tick,
// but an L7 Auditor and an unconfigured account write nothing (requireCanWrite).
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

describe('daily task reports — requireCanWrite (ADR-232)', () => {
  it('an L1 user (role viewer) passes the write gate', async () => {
    const user = asAccess(admin, { departments: { production: 'L1' } }, 'viewer');
    // Unknown report → NotFoundError after the gate.
    await expect(
      service.updateDailyReport(UNKNOWN_ID, {} as never, user),
    ).rejects.not.toBeInstanceOf(AuthorizationError);
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(service.createDailyReport({} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(service.updateDailyReport(UNKNOWN_ID, {} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('an account with nothing configured is refused', async () => {
    const user = asAccess(admin, {}, 'viewer');
    await expect(service.createDailyReport({} as never, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
