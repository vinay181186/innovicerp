import { describe, expect, it } from 'vitest';
import {
  REVISION_PATTERN,
  compareRevision,
  normalizeRevision,
  revisionBackwardsMessage,
  revisionGoesBackwards,
} from './revision';

describe('normalizeRevision', () => {
  it('upper-cases and trims', () => {
    expect(normalizeRevision(' b ')).toBe('B');
    expect(normalizeRevision('r1')).toBe('R1');
    expect(normalizeRevision('0')).toBe('0');
  });
  it('pattern accepts letters, digits, . - / and refuses spaces / lower-case', () => {
    for (const ok of ['A', 'B', 'AA', '0', '12', 'R1', '1.2', 'A-1'])
      expect(REVISION_PATTERN.test(ok)).toBe(true);
    for (const bad of ['', 'a', 'A B', '-A', 'A!']) expect(REVISION_PATTERN.test(bad)).toBe(false);
  });
});

describe('compareRevision', () => {
  it('orders letters as letters', () => {
    expect(compareRevision('A', 'B')).toBeLessThan(0);
    expect(compareRevision('Z', 'AA')).toBeLessThan(0);
    expect(compareRevision('B', 'B')).toBe(0);
  });
  it('orders numbers as numbers, not strings', () => {
    expect(compareRevision('2', '10')).toBeLessThan(0);
    expect(compareRevision('10', '9')).toBeGreaterThan(0);
  });
  it('orders prefixed numbers with the same prefix', () => {
    expect(compareRevision('R1', 'R2')).toBeLessThan(0);
    expect(compareRevision('R10', 'R9')).toBeGreaterThan(0);
  });
  it('cannot order a change of kind', () => {
    expect(compareRevision('1', 'A')).toBeNull();
    expect(compareRevision('R1', 'B')).toBeNull();
    expect(compareRevision('R1', 'S1')).toBeNull();
  });
});

describe('revisionGoesBackwards', () => {
  it('refuses B → A and 2 → 1', () => {
    expect(revisionGoesBackwards('B', 'A')).toBe(true);
    expect(revisionGoesBackwards('b', 'a')).toBe(true);
    expect(revisionGoesBackwards('2', '1')).toBe(true);
    expect(revisionGoesBackwards('R2', 'R1')).toBe(true);
  });
  it('allows forward, same, and a change of kind', () => {
    expect(revisionGoesBackwards('A', 'B')).toBe(false);
    expect(revisionGoesBackwards('A', 'a')).toBe(false);
    expect(revisionGoesBackwards('1', '2')).toBe(false);
    expect(revisionGoesBackwards('1', 'A')).toBe(false);
    expect(revisionGoesBackwards('', 'A')).toBe(false);
  });
  it('writes the sentence with normalized values', () => {
    expect(revisionBackwardsMessage(2, 'b', 'a')).toBe(
      'Line 2: Rev cannot go back from B to A — a revision only moves forward',
    );
  });
});
