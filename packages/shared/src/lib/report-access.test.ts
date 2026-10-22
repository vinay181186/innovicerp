import { describe, expect, it } from 'vitest';
import type { AccessFormKey } from '../enums/access-control';
import type { EffectiveAccess } from '../schemas/access-control';
import { canSeeReport } from './report-access';

const eff = (p: Partial<EffectiveAccess>): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: {},
  forms: {},
  ...p,
});
// One page's ticks, every other right off.
const page = (p: { price?: boolean; priceOff?: boolean }) => ({
  view: false,
  entry: false,
  advance: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  advanceOff: false,
  editOff: false,
  approveOff: false,
  ...p,
});
const user = { role: 'manager' };
const soMoney = { dept: 'sales', showsMoney: true, priceForm: 'so_create' as AccessFormKey };
const soQty = { dept: 'sales' };

describe('canSeeReport — money reports follow the page Price right', () => {
  it('a Sales L2 sees the SO money report', () => {
    expect(canSeeReport(user, eff({ departments: { sales: 'L2' } }), soMoney)).toBe(true);
  });

  it('"price OFF" on SO Master hides it, though the tier sees price', () => {
    const e = eff({ departments: { sales: 'L2' }, forms: { so_create: page({ priceOff: true }) } });
    expect(canSeeReport(user, e, soMoney)).toBe(false);
    // …but a report with no money stays visible.
    expect(canSeeReport(user, e, soQty)).toBe(true);
  });

  it('a Sales L1 Viewer is refused; a Price tick on SO Master opens it', () => {
    expect(canSeeReport(user, eff({ departments: { sales: 'L1' } }), soMoney)).toBe(false);
    const ticked = eff({
      departments: { sales: 'L1' },
      forms: { so_create: page({ price: true }) },
    });
    expect(canSeeReport(user, ticked, soMoney)).toBe(true);
  });

  it('an auditor with "price OFF" is refused; Super Admin and admin are not', () => {
    const forms = { so_create: page({ priceOff: true }) };
    expect(canSeeReport(user, eff({ auditor: true, forms }), soMoney)).toBe(false);
    expect(canSeeReport(user, eff({ auditor: true }), soMoney)).toBe(true);
    expect(canSeeReport(user, eff({ fullAccess: true, forms }), soMoney)).toBe(true);
    expect(canSeeReport({ role: 'admin' }, eff({ forms }), soMoney)).toBe(true);
  });

  it('an unknown priceForm fails closed', () => {
    const e = eff({ departments: { sales: 'L5' } });
    expect(canSeeReport(user, e, { ...soMoney, priceForm: 'nope' as AccessFormKey })).toBe(false);
  });

  it('the Reports grant still opens money, unless the page says "price OFF"', () => {
    expect(canSeeReport(user, eff({ departments: { reports: 'L3' } }), soMoney)).toBe(true);
    const off = eff({
      departments: { reports: 'L3' },
      forms: { so_create: page({ priceOff: true }) },
    });
    expect(canSeeReport(user, off, soMoney)).toBe(false);
    expect(canSeeReport(user, off, soQty)).toBe(true);
  });
});
