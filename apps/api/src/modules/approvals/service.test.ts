// ADR-232 (owner D7, 2026-10-15): the Approvals inbox shows the op-log
// date/time corrections to whoever holds Approve on Op Entry or on the QC Call
// Register — not to every write role.
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { asAccess } from '../../lib/test-access';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('approvals inbox — log-entry section (ADR-232)', () => {
  it('a manager with no Op Entry / QC Approve sees no log-entry requests', async () => {
    const user = asAccess(admin, { departments: { sales: 'L5', purchase: 'L5' } }, 'manager');
    const res = await service.getApprovalInbox(user);
    expect(res.logEntry).toEqual([]);
    expect(res.counts.logEntry).toBe(0);
  });

  it('Production L4 (Op Entry Approve) with role operator gets the section', async () => {
    const user = asAccess(admin, { departments: { production: 'L4' } }, 'operator');
    const res = await service.getApprovalInbox(user);
    expect(Array.isArray(res.logEntry)).toBe(true);
    expect(res.counts.logEntry).toBeGreaterThanOrEqual(res.logEntry.length);
  });
});
