// E5 / ADR-234 — the Entry-only "finish my own draft" rule. Pure, no database.

import { describe, expect, it } from 'vitest';
import { ownDraftPlanRefusal } from './own-draft';

const ME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

describe('ownDraftPlanRefusal', () => {
  it('allows the creator while the plan is In Planning', () => {
    expect(
      ownDraftPlanRefusal({ code: 'PLN-1', createdBy: ME, planStatus: 'in_planning' }, ME),
    ).toBeNull();
  });

  it("refuses someone else's plan", () => {
    expect(
      ownDraftPlanRefusal({ code: 'PLN-1', createdBy: OTHER, planStatus: 'in_planning' }, ME),
    ).toMatch(/Edit tick on SO\/JWSO Planning/);
  });

  it('refuses once the plan has moved past In Planning', () => {
    for (const planStatus of ['planned', 'jc_created', 'pr_created', 'cancelled']) {
      expect(ownDraftPlanRefusal({ code: 'PLN-1', createdBy: ME, planStatus }, ME)).not.toBeNull();
    }
  });

  it('refuses a legacy plan with no creator recorded', () => {
    expect(
      ownDraftPlanRefusal({ code: 'PLN-1', createdBy: null, planStatus: 'in_planning' }, ME),
    ).not.toBeNull();
  });
});
