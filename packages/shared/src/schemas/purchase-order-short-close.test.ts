import { describe, expect, it } from 'vitest';

import { PO_SHORT_CLOSE_REASON_MIN, shortClosePurchaseOrderInputSchema } from './purchase-order';

describe('shortClosePurchaseOrderInputSchema (ADR-189)', () => {
  it('accepts a reason of the minimum length, trimmed', () => {
    const reason = '  ' + 'x'.repeat(PO_SHORT_CLOSE_REASON_MIN) + '  ';
    const parsed = shortClosePurchaseOrderInputSchema.parse({ reason });
    expect(parsed.reason).toBe('x'.repeat(PO_SHORT_CLOSE_REASON_MIN));
  });

  it('refuses a reason that is too short once trimmed', () => {
    const reason = '   ' + 'x'.repeat(PO_SHORT_CLOSE_REASON_MIN - 1) + '   ';
    expect(shortClosePurchaseOrderInputSchema.safeParse({ reason }).success).toBe(false);
  });

  it('refuses a missing reason', () => {
    expect(shortClosePurchaseOrderInputSchema.safeParse({}).success).toBe(false);
  });
});
