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
  // vendorCodeText: a GRN header needs a vendor (migration 0080 CHECK).
  header: { grnDate: '2026-06-28', vendorCodeText: 'VND-1' },
  lines: [{ itemName: 'Widget', itemCodeText: 'W-1', receivedQty: 3 }],
};
// Both challan-sourced branches carry the DC receive body (ADR-162 / ADR-163).
const jobWorkReturn = {
  inwardType: 'job_work_return' as const,
  deliveryChallanId: UUID,
  receiptDate: '2026-06-28',
  lines: [{ deliveryChallanLineId: UUID2, receivedQty: 5 }],
};
const ncReturn = {
  inwardType: 'nc_return' as const,
  deliveryChallanId: UUID,
  receiptDate: '2026-06-28',
  lines: [{ deliveryChallanLineId: UUID2, receivedQty: 2 }],
};

describe('grnUnifiedSchema', () => {
  it('exposes exactly the three supported inward types (Misc deferred; JWSO Inward on Party GRN screen)', () => {
    expect([...GRN_INWARD_TYPES]).toEqual(['purchase', 'job_work_return', 'nc_return']);
  });

  it('accepts a valid NC Return payload', () => {
    expect(grnUnifiedSchema.safeParse(ncReturn).success).toBe(true);
  });

  it('rejects a challan receive with no positive line qty', () => {
    const res = grnUnifiedSchema.safeParse({
      ...ncReturn,
      lines: [{ deliveryChallanLineId: UUID2, receivedQty: 0 }],
    });
    expect(res.success).toBe(false);
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

  it('Job Work Return needs the challan id — a bare receipt body fails', () => {
    const { deliveryChallanId: _drop, ...noDc } = jobWorkReturn;
    void _drop;
    expect(grnUnifiedSchema.safeParse(noDc).success).toBe(false);
  });
});
