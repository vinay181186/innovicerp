// ADR-232 (owner D6, 2026-10-15): everyone who has been set up works their own
// tasks — the role 'viewer' refusal is gone. An L7 Auditor and an account
// nobody has configured write nothing (requireCanWrite).
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

describe('Task Board writes — requireCanWrite (ADR-232)', () => {
  it('an L1 user (role viewer) passes the write gate', async () => {
    const user = asAccess(admin, { departments: { sales: 'L1' } }, 'viewer');
    // Unknown task → NotFoundError after the gate.
    await expect(service.updateTask(UNKNOWN_ID, { title: 'x' }, user)).rejects.not.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('L7 Auditor is refused', async () => {
    const user = asAccess(admin, AUDITOR, 'viewer');
    await expect(
      service.createPersonalTodo({ title: 'adr232', priority: 'medium' }, user),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.updateTask(UNKNOWN_ID, { title: 'x' }, user)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('an account with nothing configured is refused', async () => {
    const user = asAccess(admin, {}, 'viewer');
    await expect(
      service.createPersonalTodo({ title: 'adr232', priority: 'medium' }, user),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
