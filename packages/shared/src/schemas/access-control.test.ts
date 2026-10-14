// ADR-231 — the Advance right. These pin the access model itself: the tier
// table, the per-page cascade and the effective-perms union every screen and
// every server gate reads. Before ADR-231 none of this had a unit test.
import { describe, expect, it } from 'vitest';
import { ACCESS_TIERS, accessTier, tierPermsForDept } from '../enums/access-control';
import {
  accessFormPermsSchema,
  canAdvanceForm,
  cascadeFormPerms,
  effectiveFormPerms,
  emptyFormPerms,
  type AccessFormPerms,
  type EffectiveAccess,
} from './access-control';

function access(over: Partial<EffectiveAccess> = {}): EffectiveAccess {
  return {
    fullAccess: false,
    auditor: false,
    drawingDownload: false,
    departments: {},
    forms: {},
    ...over,
  };
}

function ticks(over: Partial<AccessFormPerms>): AccessFormPerms {
  return { ...emptyFormPerms(), ...over };
}

// prodorder_create (Production Orders) and nc_dispose (NC Register) are the
// two pages the change was made for; both sit in a different department.
const PRO = 'prodorder_create' as const;
const NC = 'nc_dispose' as const;

describe('tier table', () => {
  it('gives Advance to L2, L3, L4 and L5 — not L1', () => {
    const adv = Object.fromEntries(ACCESS_TIERS.map((t) => [t.key, t.perms.advance]));
    expect(adv).toEqual({ L1: false, L2: true, L3: true, L4: true, L5: true });
  });

  it('leaves Edit where it was — L2 and L4 still cannot change a saved record', () => {
    expect(accessTier('L2').perms.edit).toBe(false);
    expect(accessTier('L4').perms.edit).toBe(false);
    expect(accessTier('L4').perms.entry).toBe(false);
  });

  it('carries Advance through tierPermsForDept', () => {
    expect(tierPermsForDept('production', 'L2').advance).toBe(true);
    expect(tierPermsForDept('production', 'L1').advance).toBe(false);
  });
});

describe('stored per-page ticks', () => {
  it('reads a row saved before Advance existed as "not ticked", with no backfill', () => {
    const old = accessFormPermsSchema.parse({ view: true, entry: true, edit: false });
    expect(old.advance).toBe(false);
    expect(old.advanceOff).toBe(false);
  });
});

describe('cascade', () => {
  it('Edit includes Advance, so an old Edit tick still grants Close', () => {
    const c = cascadeFormPerms(ticks({ edit: true }));
    expect(c).toMatchObject({ view: true, entry: true, advance: true, edit: true });
  });

  it('Entry does NOT include Advance', () => {
    const c = cascadeFormPerms(ticks({ entry: true }));
    expect(c).toMatchObject({ view: true, entry: true, advance: false, edit: false });
  });

  it('Advance alone includes View and nothing else', () => {
    const c = cascadeFormPerms(ticks({ advance: true }));
    expect(c).toMatchObject({ view: true, entry: false, advance: true, edit: false });
  });

  it('Entry + Advance, no Edit — the owner example', () => {
    const c = cascadeFormPerms(ticks({ entry: true, advance: true }));
    expect(c).toMatchObject({ view: true, entry: true, advance: true, edit: false });
  });

  it('passes advanceOff through untouched', () => {
    expect(cascadeFormPerms(ticks({ edit: true, advanceOff: true })).advanceOff).toBe(true);
  });
});

describe('effective perms', () => {
  it('Production L2, no ticks: can close a Production Order, cannot edit one', () => {
    const p = effectiveFormPerms(access({ departments: { production: 'L2' } }), PRO);
    expect(p).toMatchObject({ view: true, entry: true, advance: true, edit: false });
  });

  it('QC L2: can dispose an NC, cannot scrap (no Approve)', () => {
    const p = effectiveFormPerms(access({ departments: { qc: 'L2' } }), NC);
    expect(p.advance).toBe(true);
    expect(p.approve).toBe(false);
  });

  it('QC L4: can dispose AND scrap, still cannot create or edit', () => {
    const p = effectiveFormPerms(access({ departments: { qc: 'L4' } }), NC);
    expect(p).toMatchObject({ entry: false, advance: true, edit: false, approve: true });
  });

  it('L1 Viewer: no Advance', () => {
    expect(canAdvanceForm(access({ departments: { production: 'L1' } }), PRO)).toBe(false);
  });

  it('only the page\'s own department counts', () => {
    // Production L2 says nothing about NC Register (QC).
    expect(canAdvanceForm(access({ departments: { production: 'L2' } }), NC)).toBe(false);
  });

  it('an Advance tick grants it below the tier, on that page only', () => {
    const eff = access({ departments: { production: 'L1' }, forms: { [PRO]: ticks({ advance: true }) } });
    expect(canAdvanceForm(eff, PRO)).toBe(true);
    expect(canAdvanceForm(eff, 'jc_create')).toBe(false);
  });

  it('"No advance" takes Advance away from the tier — and only Advance', () => {
    const eff = access({ departments: { production: 'L2' }, forms: { [PRO]: ticks({ advanceOff: true }) } });
    const p = effectiveFormPerms(eff, PRO);
    expect(p).toMatchObject({ view: true, entry: true, advance: false });
    // other pages in the same department keep it
    expect(canAdvanceForm(eff, 'jc_create')).toBe(true);
  });

  it('"No edit" on an L3 leaves Advance — can close, cannot correct', () => {
    const eff = access({ departments: { production: 'L3' }, forms: { [PRO]: ticks({ editOff: true }) } });
    expect(effectiveFormPerms(eff, PRO)).toMatchObject({ advance: true, edit: false });
  });

  it('"Hide page" removes Advance with everything else', () => {
    const eff = access({ departments: { production: 'L5' }, forms: { [PRO]: ticks({ viewOff: true }) } });
    expect(effectiveFormPerms(eff, PRO)).toMatchObject({ view: false, advance: false, edit: false });
  });

  it('an old Edit tick on an L1 still grants Advance', () => {
    const eff = access({ departments: { production: 'L1' }, forms: { [PRO]: ticks({ edit: true }) } });
    expect(canAdvanceForm(eff, PRO)).toBe(true);
  });

  it('Full Access ignores "No advance"', () => {
    const eff = access({ fullAccess: true, forms: { [PRO]: ticks({ advanceOff: true }) } });
    expect(canAdvanceForm(eff, PRO)).toBe(true);
  });

  it('an Auditor reads but never advances', () => {
    const p = effectiveFormPerms(access({ auditor: true }), PRO);
    expect(p.view).toBe(true);
    expect(p.advance).toBe(false);
  });

  it('no access loaded yet → nothing', () => {
    expect(canAdvanceForm(null, PRO)).toBe(false);
  });
});
