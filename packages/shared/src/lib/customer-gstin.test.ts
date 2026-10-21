import { describe, expect, it } from 'vitest';
import { checkPartyGst, isCustomerHardIssue, isGstinStateClashMessage } from './master-rules';

// ADR-242 — which customer GST problems refuse a save in every mode.
const hard = (input: Parameters<typeof checkPartyGst>[0]) =>
  checkPartyGst(input).issues.filter(isCustomerHardIssue);

describe('customer GSTIN compulsory (ADR-242)', () => {
  it('Registered with no GSTIN is refused', () => {
    expect(
      hard({ gstCategory: 'registered_regular', stateCode: '24' }).map((i) => i.field),
    ).toEqual(['gstNumber']);
  });
  it('no GST Category is refused', () => {
    expect(hard({ stateCode: '24' }).map((i) => i.field)).toContain('gstCategory');
  });
  it('Unregistered without a GSTIN saves', () => {
    expect(hard({ gstCategory: 'unregistered', stateCode: '24' })).toEqual([]);
  });
  it('Overseas without a GSTIN saves', () => {
    expect(hard({ gstCategory: 'overseas' })).toEqual([]);
  });
  it('GSTIN vs State clash is refused and carries the code', () => {
    const gstin = checkPartyGst({
      gstCategory: 'registered_regular',
      gstNumber: '24AQKPM4121A1ZG',
    });
    // a valid Gujarat GSTIN with State Maharashtra
    const r = checkPartyGst({
      gstCategory: 'registered_regular',
      gstNumber: gstin.values.gstNumber,
      stateCode: '27',
    });
    const clash = r.issues.find((i) => i.code === 'gstin_state_clash');
    expect(clash).toBeDefined();
    expect(isCustomerHardIssue(clash!)).toBe(true);
    expect(isGstinStateClashMessage(clash!.message)).toBe(true);
  });
  it('a missing State alone (Unregistered) is not a hard stop', () => {
    expect(hard({ gstCategory: 'unregistered' })).toEqual([]);
  });
});
