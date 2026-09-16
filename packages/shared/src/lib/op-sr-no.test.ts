import { describe, expect, it } from 'vitest';
import { fmtOpSrNo, opSrNo } from './op-sr-no';

describe('opSrNo', () => {
  it('shows the stored sequence in tens', () => {
    expect(opSrNo(1)).toBe(10);
    expect(opSrNo(2)).toBe(20);
    expect(opSrNo(7)).toBe(70);
    expect(opSrNo(12)).toBe(120);
  });

  it('formats the same number as text', () => {
    expect(fmtOpSrNo(3)).toBe('30');
  });
});
