import { describe, expect, it } from 'vitest';
import {
  isPlanExecuted,
  planningLineStatus,
  toPlanningLineStatus,
  type PlanningLineStatusInput,
} from './planning-line-status';

function line(over: Partial<PlanningLineStatusInput> = {}): PlanningLineStatusInput {
  return { orderQty: 100, remaining: 100, totalPlanned: 0, directJcQty: 0, plans: [], ...over };
}

describe('planningLineStatus', () => {
  it('a line nobody has touched is unplanned at 0%', () => {
    const r = planningLineStatus(line());
    expect(r.state).toBe('unplanned');
    expect(r.label).toBe('Unplanned');
    expect(r.pct).toBe(0);
    expect(r.hasDirectJc).toBe(false);
  });

  it('a part-covered line names the qty still pending', () => {
    const r = planningLineStatus(
      line({ remaining: 40, totalPlanned: 60, plans: [{ planStatus: 'planned' }] }),
    );
    expect(r.state).toBe('partly_planned');
    expect(r.label).toBe('Partly Planned (40 pending)');
    expect(r.pct).toBe(60);
  });

  // The whole reason this file exists: a draft plan covering the full qty is
  // NOT "fully planned" — nothing has been let out to the floor yet.
  it('fully covered by a DRAFT plan is In Planning, not Fully Planned', () => {
    for (const planStatus of ['in_planning', 'planned']) {
      const r = planningLineStatus(
        line({ remaining: 0, totalPlanned: 100, plans: [{ planStatus }] }),
      );
      expect(r.state).toBe('in_planning');
      expect(r.label).toBe('In Planning');
      expect(r.pct).toBe(100);
      expect(toPlanningLineStatus(r.state)).toBe('partial');
    }
  });

  it('fully covered and every plan let out is Fully Planned', () => {
    const r = planningLineStatus(
      line({
        remaining: 0,
        totalPlanned: 100,
        plans: [{ planStatus: 'jc_created' }, { planStatus: 'complete' }],
      }),
    );
    expect(r.state).toBe('fully_planned');
    expect(toPlanningLineStatus(r.state)).toBe('fully_planned');
  });

  it('one draft among executed plans still holds the line at In Planning', () => {
    const r = planningLineStatus(
      line({
        remaining: 0,
        totalPlanned: 100,
        plans: [{ planStatus: 'jc_created' }, { planStatus: 'planned' }],
      }),
    );
    expect(r.state).toBe('in_planning');
  });

  it('covered only by a plan-less Job Card reads In Production (no plan)', () => {
    const r = planningLineStatus(line({ remaining: 0, directJcQty: 100 }));
    expect(r.state).toBe('in_production_no_plan');
    expect(r.label).toBe('In Production (no plan)');
    expect(r.hasDirectJc).toBe(true);
    expect(toPlanningLineStatus(r.state)).toBe('fully_planned');
  });

  it('a plan-less Job Card covering part of the line is partly planned', () => {
    const r = planningLineStatus(line({ remaining: 70, directJcQty: 30 }));
    expect(r.state).toBe('partly_planned');
    expect(r.label).toBe('Partly Planned (70 pending)');
    expect(r.pct).toBe(30);
  });

  it('never reports more than 100%, even when over-planned', () => {
    const r = planningLineStatus(
      line({ remaining: 0, totalPlanned: 150, plans: [{ planStatus: 'jc_created' }] }),
    );
    expect(r.pct).toBe(100);
  });

  it('a zero-qty line is 0%, not a division by zero', () => {
    const r = planningLineStatus(line({ orderQty: 0, remaining: 0 }));
    expect(r.pct).toBe(0);
    expect(Number.isFinite(r.pct)).toBe(true);
  });

  it('counts fractional covered qty (stock is numeric(14,3))', () => {
    const r = planningLineStatus(
      line({ orderQty: 8, remaining: 5.5, totalPlanned: 2.5, plans: [{ planStatus: 'planned' }] }),
    );
    expect(r.state).toBe('partly_planned');
    expect(r.label).toBe('Partly Planned (5.5 pending)');
    expect(r.pct).toBe(31);
  });

  // ADR-196: short-close ends the line. It must beat every branch below,
  // including a draft plan still sitting on it — which is exactly the case the
  // screen used to get wrong while the API got it right.
  it('a short-closed line reads Fully Planned whatever is on it', () => {
    for (const over of [
      { remaining: 60, totalPlanned: 40, plans: [{ planStatus: 'planned' }] },
      { remaining: 100, totalPlanned: 0, plans: [] },
      { remaining: 0, totalPlanned: 100, plans: [{ planStatus: 'in_planning' }] },
    ]) {
      const r = planningLineStatus(line({ ...over, shortClosed: true }));
      expect(r.state).toBe('fully_planned');
      expect(r.label).toBe('Fully Planned');
      expect(r.pct).toBe(100);
      expect(toPlanningLineStatus(r.state)).toBe('fully_planned');
    }
  });

  it('shortClosed left out behaves exactly as false', () => {
    const base = { remaining: 0, totalPlanned: 100, plans: [{ planStatus: 'planned' }] };
    expect(planningLineStatus(line(base)).state).toBe('in_planning');
    expect(planningLineStatus(line({ ...base, shortClosed: false })).state).toBe('in_planning');
  });

  // Known gap, carried over unchanged from the screen's old rule so this
  // refactor changes no behaviour. On a BUY line `totalPlanned` also counts the
  // qty on raised purchase requests, but the state only looks at plans and
  // plan-less Job Cards — so a buy line covered by a PR alone still reads
  // "Unplanned" while its percentage climbs. Fix it deliberately or not at all.
  it('a BUY line covered only by a purchase request still reads Unplanned', () => {
    const r = planningLineStatus(line({ orderQty: 10, remaining: 4, totalPlanned: 6, plans: [] }));
    expect(r.state).toBe('unplanned');
    expect(r.pct).toBe(60);
  });
});

describe('isPlanExecuted', () => {
  it('is true only once work has been let out', () => {
    expect(isPlanExecuted('jc_created')).toBe(true);
    expect(isPlanExecuted('pr_created')).toBe(true);
    expect(isPlanExecuted('in_production')).toBe(true);
    expect(isPlanExecuted('complete')).toBe(true);
    expect(isPlanExecuted('in_planning')).toBe(false);
    expect(isPlanExecuted('planned')).toBe(false);
    expect(isPlanExecuted('cancelled')).toBe(false);
  });
});
