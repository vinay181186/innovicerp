// Unit tests for the unified GRN discriminated union. Pure schema-level checks:
// the discriminator routes to the right backend contract and each branch enforces
// its existing validation. (Component/RTL tests are out of scope — the web app
// has no jsdom test harness; the UI is verified by typecheck/lint/build + manual.)

import { describe, expect, it } from 'vitest';
import { GRN_INWARD_TYPES, grnUnifiedSchema } from './grn-unified';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

const purchase = {
  inwardType: 'purchase' as const,
  header: { code: 'GRN-1', grnDate: '2026-06-28' },
  lines: [{ itemName: 'Widget', itemCodeText: 'W-1', receivedQty: 3 }],
};
const jobWorkReturn = {
  inwardType: 'job_work_return' as const,
  inwardDate: '2026-06-28',
  jwDcOutwardId: UUID,
  lines: [{ jwDcOutwardLineId: UUID2, receivedQty: 5, okQty: 4, rejectedQty: 1 }],
};

describe('grnUnifiedSchema', () => {
  it('exposes exactly the two supported inward types (Misc deferred; JWSO Inward on Party GRN screen)', () => {
    expect([...GRN_INWARD_TYPES]).toEqual(['purchase', 'job_work_return']);
  });

  it('accepts a valid Purchase payload', () => {
    expect(grnUnifiedSchema.safeParse(purchase).success).toBe(true);
  });

  it('accepts a valid Job Work Return payload', () => {
    expect(grnUnifiedSchema.safeParse(jobWorkReturn).success).toBe(true);
  });

  it('rejects the deferred miscellaneous type', () => {
    expect(grnUnifiedSchema.safeParse({ inwardType: 'miscellaneous' }).success).toBe(false);
  });

  it('rejects the JWSO Inward type (moved to the Party Material GRN screen)', () => {
    const res = grnUnifiedSchema.safeParse({
      inwardType: 'jwso_inward',
      grnDate: '2026-06-28',
      jobWorkOrderId: UUID,
      lines: [{ partyMaterialId: UUID2, receivedQty: 2 }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown inwardType', () => {
    expect(grnUnifiedSchema.safeParse({ ...purchase, inwardType: 'nonsense' }).success).toBe(false);
  });

  it('routes by discriminator — Purchase fields under a Job Work Return tag fail', () => {
    const res = grnUnifiedSchema.safeParse({
      inwardType: 'job_work_return',
      header: purchase.header,
      lines: purchase.lines,
    });
    expect(res.success).toBe(false);
  });

  it('Purchase requires at least one line', () => {
    expect(grnUnifiedSchema.safeParse({ ...purchase, lines: [] }).success).toBe(false);
  });

  it('Job Work Return enforces okQty + rejectedQty === receivedQty', () => {
    const bad = {
      ...jobWorkReturn,
      lines: [{ jwDcOutwardLineId: UUID2, receivedQty: 5, okQty: 4, rejectedQty: 0 }],
    };
    expect(grnUnifiedSchema.safeParse(bad).success).toBe(false);
  });
});
