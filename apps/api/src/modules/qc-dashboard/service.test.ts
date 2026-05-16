// QC dashboard service rides on the existing seeded + migrated data plus a
// small per-test QC log fixture so we can pin engineer perf and "today"
// counters to predictable values.
//
// Fixture rows are tagged with code/operator-name prefixes so global-setup
// (or the local teardownAll) can wipe them without touching legacy data.

import { and, eq, gte, like, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { jcOps, jobCards, opLog, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const FIXTURE_ENG_A = 'T040G-QC-A';
const FIXTURE_ENG_B = 'T040G-QC-B';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };

  // Pick any QC op already in the DB to hang the fixture logs from. IN-JC-00002
  // Op 1 MIR is guaranteed to exist post-migration; if not, fail loudly.
  const found = await db
    .select({
      id: jcOps.id,
      companyId: jcOps.companyId,
      jcCode: jobCards.code,
      opSeq: jcOps.opSeq,
    })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(and(eq(jobCards.code, 'IN-JC-00002'), eq(jcOps.opSeq, 1)))
    .limit(1);
  const op = found[0];
  if (!op) throw new Error('Expected IN-JC-00002 Op 1 from seed migration');

  // Insert fixture: engineer A logs 2 calls today (10 acc / 0 rej, 5 acc / 5 rej),
  // engineer B logs 1 call today (8 acc / 2 rej). All within the current month.
  // logNo prefix 'T040G-' is unique so afterAll can wipe by prefix.
  await db.insert(opLog).values([
    {
      companyId: op.companyId,
      jcOpId: op.id,
      logNo: 'T040G-A1',
      logType: 'qc',
      logDate: todayIso(),
      shift: 'day',
      qty: 10,
      rejectQty: 0,
      operatorName: FIXTURE_ENG_A,
      createdBy: admin.id,
    },
    {
      companyId: op.companyId,
      jcOpId: op.id,
      logNo: 'T040G-A2',
      logType: 'qc',
      logDate: todayIso(),
      shift: 'day',
      qty: 5,
      rejectQty: 5,
      operatorName: FIXTURE_ENG_A,
      createdBy: admin.id,
    },
    {
      companyId: op.companyId,
      jcOpId: op.id,
      logNo: 'T040G-B1',
      logType: 'qc',
      logDate: todayIso(),
      shift: 'day',
      qty: 8,
      rejectQty: 2,
      operatorName: FIXTURE_ENG_B,
      createdBy: admin.id,
    },
  ]);
});

afterAll(async () => {
  await db.delete(opLog).where(like(opLog.logNo, 'T040G-%'));
});

describe('qc-dashboard service', () => {
  it('admin: today summary picks up the fixture logs (3 calls, 23 acc, 7 rej, 76%)', async () => {
    const result = await service.getQcDashboard(admin, {});
    // Other QC logs may exist for today (from other tests / past smoke);
    // assert >= the fixture's contribution rather than exact equality.
    expect(result.summary.inspectedToday).toBeGreaterThanOrEqual(3);
    expect(result.summary.acceptedToday).toBeGreaterThanOrEqual(23);
    expect(result.summary.rejectedToday).toBeGreaterThanOrEqual(7);
    expect(result.summary.todayRatePct).not.toBeNull();
    expect(result.summary.todayRatePct!).toBeGreaterThanOrEqual(0);
    expect(result.summary.todayRatePct!).toBeLessThanOrEqual(100);
    expect(result.month).toBe(currentMonthIso());
    expect(result.engineer).toBeNull();
    expect(Array.isArray(result.engineers)).toBe(true);
    expect(result.engineers).toContain(FIXTURE_ENG_A);
    expect(result.engineers).toContain(FIXTURE_ENG_B);
  });

  it('engineer filter narrows summary to only that engineer', async () => {
    const result = await service.getQcDashboard(admin, { engineer: FIXTURE_ENG_A });
    // Fixture engineer A had exactly 2 calls today; nothing else in DB is
    // operator_name='T040G-QC-A', so equality is safe here.
    expect(result.summary.inspectedToday).toBe(2);
    expect(result.summary.acceptedToday).toBe(15);
    expect(result.summary.rejectedToday).toBe(5);
    expect(result.summary.todayRatePct).toBe(75);
    expect(result.engineer).toBe(FIXTURE_ENG_A);
  });

  it('engineer perf table reports per-engineer aggregates', async () => {
    const result = await service.getQcDashboard(admin, {});
    const engA = result.engineerPerf.find((r) => r.engineer === FIXTURE_ENG_A);
    const engB = result.engineerPerf.find((r) => r.engineer === FIXTURE_ENG_B);
    expect(engA).toBeDefined();
    expect(engA!.calls).toBe(2);
    expect(engA!.acceptedQty).toBe(15);
    expect(engA!.rejectedQty).toBe(5);
    expect(engA!.ratePct).toBe(75);
    expect(engB).toBeDefined();
    expect(engB!.calls).toBe(1);
    expect(engB!.acceptedQty).toBe(8);
    expect(engB!.rejectedQty).toBe(2);
    expect(engB!.ratePct).toBe(80);
  });

  it('pending list is sorted oldest qc_call_date first; rows are well-formed', async () => {
    const result = await service.getQcDashboard(admin, {});
    // Pending count must be a non-negative int even if zero.
    expect(result.summary.pendingCalls).toBeGreaterThanOrEqual(0);
    // Adjacent pairs are non-decreasing in call_date (nulls trail).
    for (let i = 1; i < result.pending.length; i++) {
      const prev = result.pending[i - 1]!.qcCallDate;
      const curr = result.pending[i]!.qcCallDate;
      if (prev !== null && curr !== null) {
        expect(prev <= curr).toBe(true);
      } else if (prev === null && curr !== null) {
        // null should not come BEFORE a non-null (NULLS LAST).
        throw new Error('pending rows ordered wrong — null call_date came before non-null');
      }
    }
    for (const row of result.pending) {
      expect(row.qcPending).toBeGreaterThan(0);
      expect(typeof row.jcCode).toBe('string');
      expect(row.opSeq).toBeGreaterThan(0);
    }
  });

  it('rejection reasons aggregate from the current month nc_register rows', async () => {
    const result = await service.getQcDashboard(admin, {});
    expect(Array.isArray(result.topRejectionReasons)).toBe(true);
    expect(result.topRejectionReasons.length).toBeLessThanOrEqual(8);
    const totalPct = result.topRejectionReasons.reduce((s, r) => s + r.pct, 0);
    // pct values sum to ~100 when there's at least one row (rounding may
    // leave a single-point slack). With zero rows the table is empty.
    if (result.topRejectionReasons.length > 0) {
      expect(totalPct).toBeGreaterThanOrEqual(95);
      expect(totalPct).toBeLessThanOrEqual(101);
    }
    for (const r of result.topRejectionReasons) {
      expect(r.count).toBeGreaterThan(0);
      expect(r.pct).toBeGreaterThanOrEqual(0);
      expect(r.pct).toBeLessThanOrEqual(100);
    }
  });

  it('overdue counter only counts pending rows with qc_call_date > 1 day old', async () => {
    const result = await service.getQcDashboard(admin, {});
    // overdueCalls is a subset of pendingCalls.
    expect(result.summary.overdueCalls).toBeLessThanOrEqual(result.summary.pendingCalls);
    // Sanity: confirm at the row level — every "wait>1 days" pending row
    // contributes (best we can assert without re-aggregating).
    const computedOverdue = result.pending.filter(
      (r) => r.waitDays !== null && r.waitDays > 1,
    ).length;
    // The pending list is LIMIT 200 — overdueCalls comes from the count
    // query that's unbounded, so overdueCalls >= what we can see in the slice.
    expect(result.summary.overdueCalls).toBeGreaterThanOrEqual(computedOverdue);
  });

  it('qc role gets full visibility (intended primary audience)', async () => {
    const qc: AuthContext = { ...admin, role: 'qc' };
    const result = await service.getQcDashboard(qc, {});
    expect(result.summary).toBeDefined();
    expect(Array.isArray(result.pending)).toBe(true);
  });

  it('operator role is rejected with AuthorizationError', async () => {
    const op: AuthContext = { ...admin, role: 'operator' };
    await expect(service.getQcDashboard(op, {})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('procurement role is rejected with AuthorizationError', async () => {
    const proc: AuthContext = { ...admin, role: 'procurement' };
    await expect(service.getQcDashboard(proc, {})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('orphan user (no company) is rejected', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.getQcDashboard(orphan, {})).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('empty month (year=1970) returns zeroed summary and empty tables', async () => {
    const result = await service.getQcDashboard(admin, { month: '1970-01' });
    expect(result.summary.monthCalls).toBe(0);
    expect(result.summary.monthAccepted).toBe(0);
    expect(result.summary.monthRejected).toBe(0);
    expect(result.summary.monthRatePct).toBeNull();
    expect(result.summary.inspectedToday).toBeGreaterThanOrEqual(0); // today still real
    expect(result.engineerPerf).toEqual([]);
    expect(result.engineers).toEqual([]);
    expect(result.topRejectionReasons).toEqual([]);
  });

  // Guard against the GREATEST(0) calculation in avg_response_days returning
  // a negative when log_date precedes qc_call_date — should clamp to 0.
  it('avgResponseDays is non-negative string or null', async () => {
    const result = await service.getQcDashboard(admin, {});
    for (const row of result.engineerPerf) {
      if (row.avgResponseDays !== null) {
        expect(Number(row.avgResponseDays)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// Defensive: make sure the fixture row count is what we expect at the end too,
// so an accidental leak from another test that touches op_log doesn't pollute
// the next run silently.
describe('qc-dashboard fixture isolation', () => {
  it('exactly 3 T040G-* log rows live during this suite', async () => {
    const start = `${currentMonthIso()}-01`;
    const rows = await db
      .select({ logNo: opLog.logNo })
      .from(opLog)
      .where(
        and(
          eq(opLog.companyId, admin.companyId!),
          like(opLog.logNo, 'T040G-%'),
          gte(opLog.logDate, start),
          lt(opLog.logDate, '9999-12-31'),
        ),
      );
    expect(rows.length).toBe(3);
  });
});
