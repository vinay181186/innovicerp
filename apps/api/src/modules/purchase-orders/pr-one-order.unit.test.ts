import { describe, expect, it } from 'vitest';
import { prDifferentOrderMessage } from '@innovic/shared';
import {
  findOrderClash,
  findVendorMismatch,
  prIdsAfterSave,
  type PrOrderRow,
} from './pr-one-order';

// ADR-316 — the pure halves of the one-order / one-vendor PO rule.

const V1 = '00000000-0000-0000-0000-0000000000v1';
const V2 = '00000000-0000-0000-0000-0000000000v2';

function pr(id: string, orderKey: string, extra: Partial<PrOrderRow> = {}): PrOrderRow {
  return {
    id,
    code: `PR-${id}`,
    orderKey,
    orderCode: orderKey === 'none' ? null : `CODE-${orderKey}`,
    vendorId: null,
    vendorCodeText: null,
    vendorCode: null,
    ...extra,
  };
}

describe('findOrderClash', () => {
  it('two PRs of the same SO → allowed', () => {
    expect(findOrderClash([pr('a', 'so:1'), pr('b', 'so:1')], [], ['a', 'b'])).toBeNull();
  });
  it('two SOs → refused, newcomer named as b', () => {
    const c = findOrderClash([pr('a', 'so:1'), pr('b', 'so:2')], [], ['a', 'b']);
    expect(c).not.toBeNull();
    expect(prDifferentOrderMessage(c!.a, c!.b)).toContain('One PO takes PRs of one SO only');
  });
  it('stock + stock → allowed; stock + SO → refused; SO + JWSO → refused', () => {
    expect(findOrderClash([pr('a', 'none'), pr('b', 'none')], [], ['a', 'b'])).toBeNull();
    expect(findOrderClash([pr('a', 'none'), pr('b', 'so:1')], [], ['a', 'b'])).not.toBeNull();
    expect(findOrderClash([pr('a', 'so:1'), pr('b', 'jw:1')], [], ['a', 'b'])).not.toBeNull();
  });
  it('message says "no SO" for a stock PR', () => {
    const c = findOrderClash([pr('a', 'so:1'), pr('b', 'none')], ['a'], ['a', 'b'])!;
    expect(c.b.id).toBe('b');
    expect(prDifferentOrderMessage(c.a, c.b)).toContain('PR-b is for no SO');
  });
  it('legacy mixed PO: same PRs, or a removal, or a PR of an order already on it → allowed', () => {
    const rows = [pr('a', 'so:1'), pr('b', 'so:2'), pr('c', 'so:1')];
    expect(findOrderClash(rows, ['a', 'b'], ['a', 'b'])).toBeNull();
    expect(findOrderClash(rows, ['a', 'b'], ['a'])).toBeNull();
    expect(findOrderClash(rows, ['a', 'b'], ['a', 'b', 'c'])).toBeNull();
  });
  it('legacy mixed PO: adding a third order → refused', () => {
    const rows = [pr('a', 'so:1'), pr('b', 'so:2'), pr('d', 'so:3')];
    expect(findOrderClash(rows, ['a', 'b'], ['a', 'b', 'd'])?.b.id).toBe('d');
  });
  it('edit adding a different-SO PR to a one-SO PO → refused', () => {
    const rows = [pr('a', 'so:1'), pr('b', 'so:2')];
    expect(findOrderClash(rows, ['a'], ['a', 'b'])?.b.id).toBe('b');
  });
});

describe('findVendorMismatch', () => {
  const po = { vendorId: V1, code: 'VEN-1' };
  it('TBD / blank PR fits any vendor', () => {
    expect(findVendorMismatch([pr('a', 'none', { vendorCodeText: 'TBD' })], po)).toBeNull();
    expect(
      findVendorMismatch([pr('a', 'none', { vendorCodeText: '(vendor TBD)' })], po),
    ).toBeNull();
    expect(findVendorMismatch([pr('a', 'none')], po)).toBeNull();
  });
  it('FK vendor must equal the header vendor', () => {
    expect(findVendorMismatch([pr('a', 'none', { vendorId: V1 })], po)).toBeNull();
    expect(findVendorMismatch([pr('a', 'none', { vendorId: V2 })], po)?.id).toBe('a');
  });
  it('text vendor compared upper-cased + trimmed to the header code', () => {
    expect(findVendorMismatch([pr('a', 'none', { vendorCodeText: ' ven-1 ' })], po)).toBeNull();
    expect(findVendorMismatch([pr('a', 'none', { vendorCodeText: 'VEN-2' })], po)?.id).toBe('a');
  });
  it('unknown PO vendor code → text PRs left alone', () => {
    expect(
      findVendorMismatch([pr('a', 'none', { vendorCodeText: 'VEN-2' })], {
        vendorId: V1,
        code: null,
      }),
    ).toBeNull();
  });
  it('text-only header compares text to text, incl. an FK PR by its code', () => {
    const textPo = { vendorId: null, code: 'VEN-1' };
    expect(findVendorMismatch([pr('a', 'none', { vendorCodeText: 'VEN-1' })], textPo)).toBeNull();
    expect(
      findVendorMismatch([pr('a', 'none', { vendorId: V2, vendorCode: 'VEN-2' })], textPo)?.id,
    ).toBe('a');
  });
});

describe('prIdsAfterSave', () => {
  const existing = [
    { id: 'l1', sourcePrId: 'p1' },
    { id: 'l2', sourcePrId: 'p2' },
  ];
  it('kept line without sourcePrId keeps its PR; dropped line loses it; new line adds', () => {
    expect(prIdsAfterSave(existing, [{ id: 'l1' }, { sourcePrId: 'p3' }])).toEqual(['p1', 'p3']);
  });
  it('re-pointed and cleared lines follow the payload', () => {
    expect(
      prIdsAfterSave(existing, [
        { id: 'l1', sourcePrId: 'p9' },
        { id: 'l2', sourcePrId: null },
      ]),
    ).toEqual(['p9']);
  });
});
