import { describe, expect, it } from 'vitest';
import {
  gstinCheckChar,
  gstinProblem,
  hsnProblem,
  resolveGstCategory,
  resolveStateCode,
} from './gst';
import { checkItemHsn, checkPartyGst } from './master-rules';

// 27AAPFU0939F1ZV — the GSTN's own published sample GSTIN.
const GOOD = '27AAPFU0939F1ZV';

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN with the right check digit', () => {
    expect(gstinCheckChar(GOOD.slice(0, 14))).toBe('V');
    expect(gstinProblem(GOOD)).toBeNull();
  });
  it('names the problem', () => {
    expect(gstinProblem('27AAPFU0939F1Z')).toMatch(/15 characters/);
    expect(gstinProblem('27AAPFU0939F1ZX')).toMatch(/check digit/);
    expect(gstinProblem('99AAPFU0939F1ZV')).toMatch(/not a GST State Code/);
    expect(gstinProblem('27aapfu0939f1zv')).toMatch(/pattern/);
  });
});

describe('State', () => {
  it('maps names, aliases and codes; refuses ambiguous text', () => {
    expect(resolveStateCode('Gujarat')).toBe('24');
    expect(resolveStateCode(' gujrat ')).toBe('24');
    expect(resolveStateCode('Jammu & Kashmir')).toBe('01');
    expect(resolveStateCode('24')).toBe('24');
    expect(resolveStateCode('7')).toBe('07');
    expect(resolveStateCode('24 - Gujarat')).toBe('24');
    expect(resolveStateCode('Gujarat (27)')).toBeNull();
    expect(resolveStateCode('Somewhere')).toBeNull();
    expect(resolveStateCode('25')).toBeNull();
  });
});

describe('party rule', () => {
  it('fills the State from the GSTIN', () => {
    const r = checkPartyGst({
      gstCategory: 'registered_regular',
      gstNumber: ` ${GOOD.toLowerCase()} `,
      state: '',
      stateCode: null,
    });
    expect(r.issues).toEqual([]);
    expect(r.values).toEqual({ gstNumber: GOOD, stateCode: '27', state: 'Maharashtra' });
  });
  it('flags a State that disagrees with the GSTIN', () => {
    const r = checkPartyGst({
      gstCategory: 'registered_regular',
      gstNumber: GOOD,
      state: null,
      stateCode: '24',
    });
    expect(r.issues.map((i) => i.field)).toEqual(['stateCode']);
  });
  it('needs a GSTIN unless Unregistered / Overseas', () => {
    expect(
      checkPartyGst({ gstCategory: 'sez', gstNumber: null, state: null, stateCode: '24' }).issues[0]
        ?.field,
    ).toBe('gstNumber');
    expect(
      checkPartyGst({ gstCategory: 'unregistered', gstNumber: null, state: null, stateCode: '24' })
        .issues,
    ).toEqual([]);
    expect(
      checkPartyGst({ gstCategory: 'overseas', gstNumber: null, state: null, stateCode: null })
        .issues,
    ).toEqual([]);
    expect(
      checkPartyGst({ gstCategory: 'unregistered', gstNumber: GOOD, state: null, stateCode: '27' })
        .issues[0]?.field,
    ).toBe('gstCategory');
  });
  it('asks for a GST Category and a State', () => {
    const r = checkPartyGst({ gstCategory: null, gstNumber: null, state: null, stateCode: null });
    expect(r.issues.map((i) => i.field).sort()).toEqual(['gstCategory', 'stateCode']);
  });
  it('resolves category words', () => {
    expect(resolveGstCategory('Registered Regular')).toBe('registered_regular');
    expect(resolveGstCategory('SEZ')).toBe('sez');
    expect(resolveGstCategory('xyz')).toBeNull();
  });
});

describe('HSN rule', () => {
  it('checks format always and presence only for sold items with Check HSN on', () => {
    expect(hsnProblem('8483', 6)).toMatch(/at least 6/);
    expect(hsnProblem('84831', 4)).toMatch(/4, 6 or 8/);
    expect(hsnProblem('848310', 6)).toBeNull();
    const on = { checkHsn: true, hsnMinDigits: 6 };
    const off = { checkHsn: false, hsnMinDigits: 6 };
    expect(checkItemHsn({ itemType: 'component', hsnCode: '' }, on)).toHaveLength(1);
    expect(checkItemHsn({ itemType: 'raw_material', hsnCode: '' }, on)).toHaveLength(0);
    expect(checkItemHsn({ itemType: 'component', hsnCode: '' }, off)).toHaveLength(0);
    expect(checkItemHsn({ itemType: 'raw_material', hsnCode: '12ab' }, off)).toHaveLength(1);
  });
});
