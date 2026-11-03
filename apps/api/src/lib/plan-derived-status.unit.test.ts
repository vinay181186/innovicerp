// derivePlanStatus — the status a route-card plan's row shows. Pure function,
// no database; run it via `pnpm --filter @innovic/api test:unit`.
//
// Owner 2026-11-03 ("Part Prod"): an open order with qty still Pending reads
// 'partly_in_production', not 'in_production' (plan 0182 hid its un-ordered qty).

import { describe, expect, it } from 'vitest';

import { derivePlanStatus, type PlanDerivedStatusInput } from './plan-derived-status';

function plan(over: Partial<PlanDerivedStatusInput> = {}): PlanDerivedStatusInput {
  return {
    opsSource: 'route_card',
    planStatus: 'planned',
    hasRouteCard: true,
    routeCardUsable: true,
    activeOrderCount: 0,
    openOrderCount: 0,
    pendingQty: 0,
    ...over,
  };
}

describe('derivePlanStatus', () => {
  it('open order covering the whole plan → in_production', () => {
    expect(derivePlanStatus(plan({ activeOrderCount: 1, openOrderCount: 1 }))).toBe(
      'in_production',
    );
  });

  it('open order with qty still Pending → partly_in_production (Part Prod)', () => {
    expect(derivePlanStatus(plan({ activeOrderCount: 1, openOrderCount: 1, pendingQty: 40 }))).toBe(
      'partly_in_production',
    );
  });

  it('Part Prod even when the Route Card is no longer approved (live work wins)', () => {
    expect(
      derivePlanStatus(
        plan({ openOrderCount: 1, pendingQty: 10, hasRouteCard: true, routeCardUsable: false }),
      ),
    ).toBe('partly_in_production');
  });

  it('no open order, qty Pending → the route-card branches, unchanged', () => {
    expect(derivePlanStatus(plan({ pendingQty: 20 }))).toBe('gen_production_order');
    expect(derivePlanStatus(plan({ pendingQty: 20, routeCardUsable: false }))).toBe(
      'route_card_approval_pending',
    );
    expect(
      derivePlanStatus(plan({ pendingQty: 20, hasRouteCard: false, routeCardUsable: false })),
    ).toBe('route_card_pending');
  });

  it('nothing open, nothing Pending → production_complete', () => {
    expect(derivePlanStatus(plan({ activeOrderCount: 1 }))).toBe('production_complete');
  });

  it('old plans and cancelled plans have no derived status', () => {
    expect(derivePlanStatus(plan({ opsSource: 'plan', openOrderCount: 1, pendingQty: 5 }))).toBe(
      null,
    );
    expect(
      derivePlanStatus(plan({ planStatus: 'cancelled', openOrderCount: 1, pendingQty: 5 })),
    ).toBe(null);
  });
});
