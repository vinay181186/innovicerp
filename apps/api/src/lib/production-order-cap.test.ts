// Unit test for the Production Order qty cap (ADR-182). Pure arithmetic, no
// database. Runnable on its own with
// `npx vitest run src/lib/production-order-cap.test.ts` — vitest's globalSetup
// is a no-op without DATABASE_URL in the environment.

import { describe, expect, it } from 'vitest';
import {
  planCoverage,
  planQtyBelowCoveredError,
  productionOrderCapError,
} from './production-order-cap';

describe('planCoverage (ADR-182 Plan Qty / Covered / Pending)', () => {
  it('reports what is left of the plan', () => {
    expect(planCoverage(50, 20)).toEqual({ planQty: 50, coveredQty: 20, pendingQty: 30 });
  });

  it('is Pending 0 once the plan is fully covered', () => {
    expect(planCoverage(50, 50)).toEqual({ planQty: 50, coveredQty: 50, pendingQty: 0 });
  });

  it('never reports a negative Pending, even on over-covered data', () => {
    expect(planCoverage(50, 80).pendingQty).toBe(0);
  });

  it('a plan with no orders yet is entirely Pending', () => {
    expect(planCoverage(50, 0)).toEqual({ planQty: 50, coveredQty: 0, pendingQty: 50 });
  });
});

describe('productionOrderCapError (ADR-182)', () => {
  // The ADR's own walk-through: a plan of 50 covered by 20 + 20 leaves 10, and
  // a third order of 30 is refused.
  it('allows the first order of a fresh plan', () => {
    expect(productionOrderCapError('PLN-0009', 50, 0, 20)).toBeNull();
  });

  it('allows a second order that still fits', () => {
    expect(productionOrderCapError('PLN-0009', 50, 20, 20)).toBeNull();
  });

  it('allows an order that exactly finishes the plan', () => {
    expect(productionOrderCapError('PLN-0009', 50, 40, 10)).toBeNull();
  });

  it('refuses an order bigger than what is left, and says how much is left', () => {
    expect(productionOrderCapError('PLN-0009', 50, 40, 30)).toBe(
      'Plan PLN-0009 has only 10 left of 50 — reduce the qty.',
    );
  });

  it('refuses one piece over the line', () => {
    expect(productionOrderCapError('PLN-0009', 50, 40, 11)).toBe(
      'Plan PLN-0009 has only 10 left of 50 — reduce the qty.',
    );
  });

  it('says "fully covered" rather than "only 0 left" when nothing remains', () => {
    expect(productionOrderCapError('PLN-0009', 50, 50, 1)).toBe(
      'Plan PLN-0009 is fully covered by its Production Orders (50 of 50).',
    );
  });

  it('still says "fully covered" when the data is over-covered', () => {
    expect(productionOrderCapError('PLN-0009', 50, 60, 5)).toBe(
      'Plan PLN-0009 is fully covered by its Production Orders (50 of 50).',
    );
  });

  // A short-closed order is excluded from `covered` by the caller (the SQL
  // filters on status <> 'short_closed'), so stopping a 20 gives 20 back and
  // the very order that was refused a moment ago now fits.
  it('lets a refused qty through once a short close returns the covered pieces', () => {
    expect(productionOrderCapError('PLN-0009', 50, 40, 30)).not.toBeNull();
    expect(productionOrderCapError('PLN-0009', 50, 20, 30)).toBeNull();
  });
});

// The whole short-close promise, as arithmetic: the freed qty must come back as
// Pending AND be orderable again. The status side of it (plans.plan_status back
// to 'planned') lives in shortCloseProductionOrder — this is the number.
describe('short close returns the qty to the plan (ADR-182)', () => {
  it('fully covered plan becomes fully orderable again', () => {
    // Plan 50, one order of 50 → nothing left.
    expect(planCoverage(50, 50).pendingQty).toBe(0);
    expect(productionOrderCapError('PLN-0009', 50, 50, 50)).toBe(
      'Plan PLN-0009 is fully covered by its Production Orders (50 of 50).',
    );
    // Short close it: covered drops to 0 (the SUM skips short_closed orders).
    expect(planCoverage(50, 0).pendingQty).toBe(50);
    expect(productionOrderCapError('PLN-0009', 50, 0, 50)).toBeNull();
  });

  it('partly covered plan gives back only the stopped order', () => {
    // Plan 50 covered by 20 + 30 → nothing left; stop the 30 → 30 back.
    expect(planCoverage(50, 50).pendingQty).toBe(0);
    expect(planCoverage(50, 20)).toEqual({ planQty: 50, coveredQty: 20, pendingQty: 30 });
    expect(productionOrderCapError('PLN-0009', 50, 20, 30)).toBeNull();
    expect(productionOrderCapError('PLN-0009', 50, 20, 31)).toBe(
      'Plan PLN-0009 has only 30 left of 50 — reduce the qty.',
    );
  });
});

describe('planQtyBelowCoveredError (plan edit vs live orders)', () => {
  it('allows any edit on a plan with no live order', () => {
    expect(planQtyBelowCoveredError('PLN-0009', 10, 0)).toBeNull();
  });

  it('allows cutting the plan down to exactly what is covered', () => {
    expect(planQtyBelowCoveredError('PLN-0009', 20, 20)).toBeNull();
  });

  it('allows raising the plan qty', () => {
    expect(planQtyBelowCoveredError('PLN-0009', 80, 20)).toBeNull();
  });

  it('refuses a plan qty below the covered qty, naming the figure', () => {
    expect(planQtyBelowCoveredError('PLN-0009', 10, 20)).toBe(
      'Plan PLN-0009 already has Production Orders for 20 — Plan Qty cannot be less than that.',
    );
  });

  it('is free again once the covering order is short closed', () => {
    // covered drops to 0 with the stop, so the same edit now passes.
    expect(planQtyBelowCoveredError('PLN-0009', 10, 0)).toBeNull();
  });
});
