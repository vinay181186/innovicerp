import { describe, expect, it } from 'vitest';
import { columnWidth, fitColumns, type FitInput } from './fit-layout';

// The Route Card list at ~1870 px: two text columns, the rest exact-fit.
function routeCardInput(avail: number): FitInput {
  const order = ['sr', 'rc', 'code', 'name', 'rm', 'ops', 'rev', 'status', 'updated'];
  return {
    order,
    pins: [],
    hidden: [],
    firstId: 'sr',
    kinds: { name: 'text', rm: 'text' },
    widths: {
      sr: columnWidth('num', 45, 30, 0),
      rc: columnWidth('code', 60, 115, 0),
      code: columnWidth('code', 80, 140, 0),
      name: columnWidth('text', 90, 170, 0),
      rm: columnWidth('text', 150, 270, 0),
      ops: columnWidth('num', 40, 25, 0),
      rev: columnWidth('code', 110, 30, 0),
      status: columnWidth('code', 85, 100, 0),
      updated: columnWidth('date', 105, 115, 0),
    },
    avail,
    actionsW: 55,
    selW: 0,
  };
}

describe('fitColumns — spare width', () => {
  it('spreads the left-over width over every column, not only the text ones', () => {
    const r = fitColumns(routeCardInput(1870));
    const used = Object.values(r.w).reduce((a, b) => a + b, 0);
    expect(used).toBeLessThanOrEqual(r.budget);
    expect(r.budget - used).toBeLessThan(r.visible.length);
    // Each code / date column grows past its exact fit…
    expect(r.w['rc']).toBeGreaterThan(115);
    expect(r.w['updated']).toBeGreaterThan(115);
    // …and Item Name no longer swallows ~300 px of empty space.
    expect(r.w['name']).toBeLessThan(300);
  });

  it('changes nothing when there is no spare width', () => {
    const tight = routeCardInput(1000);
    const r = fitColumns(tight);
    expect(r.w['rc']).toBe(115);
    expect(r.w['updated']).toBe(115);
  });

  it('keeps text columns growing toward their ideal first', () => {
    // Room for the minimums + a little: text columns take it all.
    const r = fitColumns(routeCardInput(1000 + 55 + 60));
    expect(r.w['rc']).toBe(115);
    expect((r.w['name'] ?? 0) + (r.w['rm'] ?? 0)).toBeGreaterThan(120 + 150);
  });
});
