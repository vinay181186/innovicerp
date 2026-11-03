import { describe, expect, it } from 'vitest';
import { fmtQty } from './qty-format';

describe('fmtQty', () => {
  it('whole numbers stay whole', () => {
    expect(fmtQty(12)).toBe('12');
    expect(fmtQty(0)).toBe('0');
    expect(fmtQty(125000)).toBe('1,25,000');
  });
  it('real fractions show up to 3 decimals, no trailing zeros', () => {
    expect(fmtQty(1.5)).toBe('1.5');
    expect(fmtQty(0.125)).toBe('0.125');
    expect(fmtQty(2.3333)).toBe('2.333');
    expect(fmtQty(0.1 + 0.2)).toBe('0.3');
  });
  it('reads numeric strings; blank / junk → empty', () => {
    expect(fmtQty('12.000')).toBe('12');
    expect(fmtQty('2.500')).toBe('2.5');
    expect(fmtQty(null)).toBe('—');
    expect(fmtQty('', '')).toBe('');
    expect(fmtQty('abc')).toBe('—');
    expect(fmtQty(-0.0001)).toBe('0');
  });
});
