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

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('fitColumns — spare width', () => {
  it('never makes a column wider than its content; the rest is empty space after ⋯', () => {
    const r = fitColumns(routeCardInput(1870));
    // Code / date columns stay at their exact fit…
    expect(r.w['rc']).toBe(115);
    expect(r.w['updated']).toBe(115);
    // …text columns grow only until their full text shows…
    expect(r.w['name']).toBe(170);
    expect(r.w['rm']).toBe(270);
    // …and the left-over is the empty end column; the row still fills the width.
    expect(r.fill).toBe(710);
    expect(sum(r.w) + r.fill).toBe(r.budget);
  });

  it('changes nothing for short columns when there is no spare width', () => {
    const r = fitColumns(routeCardInput(1000));
    expect(r.w['rc']).toBe(115);
    expect(r.w['updated']).toBe(115);
    expect(r.fill).toBe(0);
    expect(sum(r.w)).toBe(r.budget);
  });

  it('gives a little spare width to the cut text columns only, filling the width exactly', () => {
    // Room for the minimums + 125 px, while the texts want 50 + 120: the
    // smaller need is finished first, the rest goes to the other.
    const r = fitColumns(routeCardInput(1000 + 55 + 60));
    expect(r.w['rc']).toBe(115);
    expect(r.w['name']).toBe(170);
    expect(r.w['rm']).toBe(150 + 75);
    expect(r.fill).toBe(0);
    expect(sum(r.w)).toBe(r.budget);
  });

  it('does not let one very long text starve a short one', () => {
    const input = routeCardInput(1000 + 55 + 60);
    // RM Grade / RM Size holds one 3000 px note.
    const r = fitColumns({
      ...input,
      widths: { ...input.widths, rm: columnWidth('text', 150, 3000, 0) },
    });
    expect(r.w['name']).toBe(170); // shows in full
    expect(r.w['rm']).toBe(150 + 75);
    expect(sum(r.w)).toBe(r.budget);
  });

  it('lets a long text column grow to its full length (no 300 px stop)', () => {
    expect(columnWidth('text', 90, 900, 0)).toEqual({ min: 120, ideal: 900 });
  });

  it('puts all spare width in the empty end column when no column is text', () => {
    const input = routeCardInput(1870);
    const r = fitColumns({ ...input, kinds: {} });
    // Every column at its measured width, nothing spread over them…
    for (const k of r.visible) expect(r.w[k]).toBe(input.widths[k]?.min);
    // …all of the spare width (1815 − 935) is the empty space.
    expect(r.fill).toBe(880);
  });
});
