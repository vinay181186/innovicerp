import { describe, expect, it } from 'vitest';
import { createItemInputSchema, itemCodeBadChars, itemCodeCheckQuerySchema } from './item';

// ADR-297 — the Item Code box's live hint uses the same rule as Save.
describe('itemCodeBadChars', () => {
  it('lets letters, numbers, dot, underscore and hyphen through', () => {
    expect(itemCodeBadChars('ITM-0013_a.1')).toEqual([]);
  });
  it('names each refused character once, a space as "space"', () => {
    expect(itemCodeBadChars('AB/12 C/&')).toEqual(['/', 'space', '&']);
  });
  it('ignores spaces at the ends (Save trims them)', () => {
    expect(itemCodeBadChars('  ITM-1  ')).toEqual([]);
  });
  it('agrees with the create schema', () => {
    for (const code of ['ITM-1', 'A/B', 'A B', 'A#1', 'x.y_z-1']) {
      const ok = createItemInputSchema.shape.code.safeParse(code).success;
      expect(itemCodeBadChars(code).length === 0).toBe(ok);
    }
  });
});

describe('itemCodeCheckQuerySchema', () => {
  it('trims the code and refuses a blank one', () => {
    expect(itemCodeCheckQuerySchema.parse({ code: ' ITM-1 ' }).code).toBe('ITM-1');
    expect(itemCodeCheckQuerySchema.safeParse({ code: '  ' }).success).toBe(false);
  });
});
