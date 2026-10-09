// Unit test for the Job Card requirement list (ADR-225 phase 4). Pure
// arithmetic, no database. Runnable on its own with
// `npx vitest run src/lib/ml-assembly.test.ts` — vitest's globalSetup is a
// no-op without DATABASE_URL in the environment.

import { describe, expect, it } from 'vitest';
import { childPartRequirements } from './ml-assembly';

const RM = { itemId: 'rm', required: 25 };

describe('childPartRequirements (ADR-225 sub-assembly Job Card)', () => {
  it('an ordinary card keeps exactly its RM line', () => {
    expect(childPartRequirements(RM, [], 10)).toEqual([RM]);
  });

  it('a card with no RM and no children requires nothing', () => {
    expect(childPartRequirements(null, [], 10)).toEqual([]);
  });

  it('a sub-assembly card requires each child part × JC qty, in tree order', () => {
    expect(
      childPartRequirements(
        null,
        [
          { itemId: 'shaft', qtyPerSet: 1 },
          { itemId: 'bolt', qtyPerSet: 4 },
        ],
        5,
      ),
    ).toEqual([
      { itemId: 'shaft', required: 5 },
      { itemId: 'bolt', required: 20 },
    ]);
  });

  it('rounds to 3 decimals', () => {
    expect(childPartRequirements(null, [{ itemId: 'wire', qtyPerSet: 0.333 }], 3)).toEqual([
      { itemId: 'wire', required: 0.999 },
    ]);
  });

  it('keeps the RM line first and folds a child that is the RM item into it', () => {
    expect(
      childPartRequirements(
        RM,
        [
          { itemId: 'rm', qtyPerSet: 0.5 },
          { itemId: 'bolt', qtyPerSet: 2 },
        ],
        10,
      ),
    ).toEqual([
      { itemId: 'rm', required: 30 },
      { itemId: 'bolt', required: 20 },
    ]);
  });

  it('does not mutate the RM line it was given', () => {
    const rm = { itemId: 'rm', required: 25 };
    childPartRequirements(rm, [{ itemId: 'rm', qtyPerSet: 1 }], 10);
    expect(rm.required).toBe(25);
  });
});
