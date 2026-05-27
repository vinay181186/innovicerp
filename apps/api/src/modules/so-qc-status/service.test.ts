// SO QC Status service tests. Read-only over the seeded + migrated DB. The
// per-line rollup spans four stages (QC Ops / TPI / GRN-QC / Docs); exact
// counts depend on seed data, so we assert invariants (done<=total,
// accepted+rejected<=received, overall in enum) against whichever SO has lines,
// matching the qc-dashboard suite's structural-assertion philosophy.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

let admin: AuthContext;
let sampleSoId: string | null = null;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const list = await service.listSoForQc(admin);
  sampleSoId = list.sos[0]?.id ?? null;
});

describe('so-qc-status service', () => {
  it('listSoForQc returns a sos array scoped to the company', async () => {
    const res = await service.listSoForQc(admin);
    expect(Array.isArray(res.sos)).toBe(true);
    for (const s of res.sos) {
      expect(typeof s.code).toBe('string');
      expect(s.status).not.toBe('cancelled');
    }
  });

  it('orphan user (no company) is rejected on list', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.listSoForQc(orphan)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('getSoQcStatus on a non-existent SO throws NotFound', async () => {
    await expect(service.getSoQcStatus(ZERO_UUID, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('per-line rollup holds stage invariants across all four stages', async () => {
    if (!sampleSoId) {
      // No SOs in this DB — nothing to assert beyond the empty contract.
      return;
    }
    const res = await service.getSoQcStatus(sampleSoId, admin);
    expect(res.so.id).toBe(sampleSoId);
    expect(Array.isArray(res.lines)).toBe(true);
    for (const l of res.lines) {
      // QC ops
      expect(l.qcOpsPassed).toBeLessThanOrEqual(l.qcOpsTotal);
      // GRN-QC
      expect(l.grnDone).toBeLessThanOrEqual(l.grnTotal);
      expect(l.grnAccepted + l.grnRejected).toBeLessThanOrEqual(l.grnReceived);
      expect(l.grnDetail.length).toBe(l.grnTotal);
      expect(l.grnDetail.filter((g) => g.status === 'done').length).toBe(l.grnDone);
      // Docs
      expect(l.docCount).toBeGreaterThanOrEqual(0);
      expect(l.docDetail.length).toBe(l.docCount);
      expect(l.docUploaded).toBeLessThanOrEqual(l.docCount);
      // TPI detail array length matches the count.
      expect(l.tpiDetail.length).toBe(l.tpiCount);
      // Rich QC-stage cell: total ops across JCs == qcOpsTotal.
      expect(l.jcQc.reduce((s, j) => s + j.ops.length, 0)).toBe(l.qcOpsTotal);
      // Overall % bar is bounded.
      expect(l.overallPct).toBeGreaterThanOrEqual(0);
      expect(l.overallPct).toBeLessThanOrEqual(100);
      // Overall enum
      expect(['none', 'pending', 'in_progress', 'passed']).toContain(l.overall);
      // hasAnyQc is true exactly when some stage exists.
      expect(l.hasAnyQc).toBe(
        l.qcOpsTotal > 0 || l.tpiCount > 0 || l.grnTotal > 0 || l.docCount > 0,
      );
      // A line with no stage activity at all reads as 'none'.
      if (l.qcOpsTotal === 0 && l.tpiCount === 0 && l.grnTotal === 0 && l.docCount === 0) {
        expect(l.overall).toBe('none');
        expect(l.hasAnyQc).toBe(false);
      }
    }
  });
});
