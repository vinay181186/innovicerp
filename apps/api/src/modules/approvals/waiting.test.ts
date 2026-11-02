// ADR-265 — GET /approvals/waiting and /approvals/history on the TEST database:
// the responses match the shared contract, counts agree with the rows, and a
// caller with no approve right of any kind gets nothing.
import {
  approvalHistoryListResponseSchema,
  WAITING_APPROVALS_LIMIT,
  waitingApprovalsResponseSchema,
} from '@innovic/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { asAccess } from '../../lib/test-access';
import { listApprovalHistory } from './history';
import { getWaitingApprovals } from './waiting';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

/** A Sales viewer: opens pages, approves nothing (no Day Log head either). */
const nonApprover = (): AuthContext =>
  asAccess(admin, { departments: { sales: 'L1' } }, 'operator');

describe('approvals waiting (ADR-265)', () => {
  it('admin: parses, counts agree with rows, no zero counts', async () => {
    const res = waitingApprovalsResponseSchema.parse(await getWaitingApprovals(admin));
    expect(res.canApprove).toBe(true);
    expect(res.counts.every((c) => c.n > 0)).toBe(true);
    const sum = res.counts.reduce((s, c) => s + c.n, 0);
    expect(sum).toBe(res.total);
    expect(res.rows.length).toBeLessThanOrEqual(WAITING_APPROVALS_LIMIT);
    // Under the cap every waiting row is listed (log entries stop at their own 200).
    const logN = res.counts.find((c) => c.typeKey === 'logEntry')?.n ?? 0;
    if (res.total < WAITING_APPROVALS_LIMIT && logN <= 200) {
      expect(res.rows.length).toBe(res.total);
    }
    // Per type, the rows never exceed the count.
    for (const c of res.counts) {
      expect(res.rows.filter((r) => r.typeKey === c.typeKey).length).toBeLessThanOrEqual(c.n);
    }
    // Oldest first.
    const times = res.rows.map((r) => Date.parse(r.raisedAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // Only edit rows are reviewed field by field; only rc / dayLog carry a version.
    for (const r of res.rows) {
      expect(r.mode).toBe(r.kind === 'edit' ? 'review' : 'direct');
      if (r.kind !== 'edit') expect(r.changes).toEqual([]);
      if (r.kind === 'rc' || r.kind === 'dayLog') expect(r.version).not.toBeNull();
      else expect(r.version).toBeNull();
    }
  });

  it('a caller with no approve right gets no rows and canApprove false', async () => {
    const res = waitingApprovalsResponseSchema.parse(await getWaitingApprovals(nonApprover()));
    expect(res.rows).toEqual([]);
    expect(res.counts).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.canApprove).toBe(false);
  });
});

describe('approvals history (ADR-265)', () => {
  it('approved and rejected both parse; total ≥ rows; counts never zero', async () => {
    for (const decision of ['approved', 'rejected'] as const) {
      const res = approvalHistoryListResponseSchema.parse(
        await listApprovalHistory({ decision, limit: 25, offset: 0 }, admin),
      );
      expect(res.total).toBeGreaterThanOrEqual(res.rows.length);
      expect(res.counts.every((c) => c.n > 0)).toBe(true);
      expect(res.counts.reduce((s, c) => s + c.n, 0)).toBe(res.total);
      expect(res.rows.every((r) => r.decision === decision)).toBe(true);
      const times = res.rows.map((r) => Date.parse(r.decidedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    }
  });

  it('the type filter narrows rows and total to that type', async () => {
    const all = await listApprovalHistory({ decision: 'approved' }, admin);
    const first = all.counts[0];
    if (!first) return;
    const one = await listApprovalHistory({ decision: 'approved', type: first.typeKey }, admin);
    expect(one.total).toBe(first.n);
    expect(one.rows.every((r) => r.typeKey === first.typeKey)).toBe(true);
    expect(one.counts).toEqual(all.counts);
  });

  it('a caller with no approve right sees no history', async () => {
    const res = await listApprovalHistory({ decision: 'approved' }, nonApprover());
    expect(res).toEqual({ rows: [], counts: [], total: 0 });
  });
});
