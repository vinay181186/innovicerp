import { describe, expect, it } from 'vitest';
import { lineBasicValue, linesBasicTotal } from './line-value';

describe('lineBasicValue (ADR-302 Total Value (Basic))', () => {
  it('is qty × rate', () => {
    expect(lineBasicValue(2, '90000.00')).toBe(180000);
  });
  it('treats blank / null / junk as 0', () => {
    expect(lineBasicValue(2, null)).toBe(0);
    expect(lineBasicValue(undefined, '5')).toBe(0);
    expect(lineBasicValue('x', '5')).toBe(0);
  });
  it('rounds a decimal qty to the paisa', () => {
    expect(lineBasicValue(0.333, '10.01')).toBe(3.33);
  });
});

describe('linesBasicTotal (Subtotal)', () => {
  it('leaves cancelled lines out', () => {
    expect(
      linesBasicTotal([
        { qty: 2, rate: '90000', status: 'open' },
        { qty: 5, rate: '100', status: 'cancelled' },
        { qty: 3, rate: '12.5' },
      ]),
    ).toBe(180037.5);
  });
  it('rounds once on the sum, as the old Subtotal did', () => {
    expect(
      linesBasicTotal([
        { qty: 0.1, rate: 0.1 },
        { qty: 0.2, rate: 0.1 },
      ]),
    ).toBe(0.03);
    expect(linesBasicTotal([])).toBe(0);
  });
});
