import { describe, expect, it } from 'vitest';
import { productionOrderShortClosedQty } from './production-order-status';

describe('productionOrderShortClosedQty (ADR-233)', () => {
  it('is 0 while the order can still produce', () => {
    expect(productionOrderShortClosedQty({ status: 'open', orderQty: 10, creditedQty: null })).toBe(0);
    expect(
      productionOrderShortClosedQty({ status: 'partially_closed', orderQty: 10, creditedQty: 6 }),
    ).toBe(0);
  });

  it('is order − stock received once stopped, including lost pieces', () => {
    expect(
      productionOrderShortClosedQty({ status: 'short_closed', orderQty: 10, creditedQty: 6 }),
    ).toBe(4);
    expect(
      productionOrderShortClosedQty({ status: 'short_closed', orderQty: 10, creditedQty: null }),
    ).toBe(10);
    expect(productionOrderShortClosedQty({ status: 'closed', orderQty: 10, creditedQty: 8 })).toBe(2);
  });

  it('is 0 for a fully received order and never negative', () => {
    expect(productionOrderShortClosedQty({ status: 'closed', orderQty: 10, creditedQty: 10 })).toBe(0);
    expect(productionOrderShortClosedQty({ status: 'closed', orderQty: 10, creditedQty: 12 })).toBe(0);
  });
});
