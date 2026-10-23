// Reorder Level / Reorder Qty — the one check shared by the Item edit writer,
// the Store → Reorder direct save and its staging pre-check (ADR-249 B2).
// Pure, no database.

import { describe, expect, it } from 'vitest';
import { assertReorderSettable, notReorderableMessage } from './reorder-check';

const comp = { code: 'ITM-0001', uom: 'NOS', itemType: 'component' };

describe('assertReorderSettable', () => {
  it('returns the rounded pair for a reorderable item', () => {
    expect(assertReorderSettable({ ...comp, uom: 'KGS' }, 10.0004, 2.5)).toEqual({
      level: 10,
      qty: 2.5,
    });
  });
  it('refuses a level on an Assembly, but always allows clearing (0 / 0)', () => {
    const asm = { ...comp, itemType: 'assembly' };
    expect(() => assertReorderSettable(asm, 5, 0)).toThrow(notReorderableMessage('ITM-0001'));
    expect(() => assertReorderSettable(asm, 0, 3)).toThrow(notReorderableMessage('ITM-0001'));
    expect(assertReorderSettable(asm, 0, 0)).toEqual({ level: 0, qty: 0 });
  });
  it('refuses a decimal on a whole-number unit, naming the field', () => {
    expect(() => assertReorderSettable(comp, 2.5, 0)).toThrow(/Reorder Level \(2\.5\)/);
    expect(() => assertReorderSettable(comp, 2, 1.5)).toThrow(/Reorder Qty \(1\.5\)/);
  });
});
