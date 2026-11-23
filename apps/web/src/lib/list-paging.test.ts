import { describe, expect, it } from 'vitest';

import {
  fetchAllPages,
  fetchAllPagesCounted,
  lastPage,
  pageOffset,
  pageSearchParam,
} from './list-paging';

describe('list paging', () => {
  it('page maths', () => {
    expect(pageOffset(1)).toBe(0);
    expect(pageOffset(3)).toBe(50);
    expect(pageOffset(0)).toBe(0);
    expect(lastPage(0)).toBe(1);
    expect(lastPage(25)).toBe(1);
    expect(lastPage(26)).toBe(2);
  });
  it('bad page params read as 1', () => {
    expect(pageSearchParam.parse('x')).toBe(1);
    expect(pageSearchParam.parse(-2)).toBe(1);
    expect(pageSearchParam.parse(undefined)).toBe(1);
    expect(pageSearchParam.parse('4')).toBe(4);
  });
  it('fetchAllPages gets every row in chunks and stops at the total', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => i);
    const calls: number[] = [];
    const all = await fetchAllPages(async (limit, offset) => {
      calls.push(offset);
      return { items: rows.slice(offset, offset + limit), total: rows.length };
    });
    expect(all).toHaveLength(450);
    expect(calls).toEqual([0, 200, 400]);
  });
  it('fetchAllPagesCounted reads pages in parallel, keeps their order, honours the cap', async () => {
    const rows = Array.from({ length: 1950 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;
    const res = await fetchAllPagesCounted(
      async (limit, offset) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // Later pages answer first — the result must still be in row order.
        await new Promise((r) => setTimeout(r, 2000 / (offset + 1)));
        inFlight -= 1;
        return { items: rows.slice(offset, offset + limit), total: rows.length };
      },
      200,
      undefined,
      1000,
    );
    expect(res.items).toEqual(rows.slice(0, 1000));
    expect(res.total).toBe(1950);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
  it('fetchAllPagesCounted stops on a short page', async () => {
    const calls: number[] = [];
    const res = await fetchAllPagesCounted(async (limit, offset) => {
      calls.push(offset);
      return { items: Array.from({ length: offset === 0 ? limit : 30 }, () => offset), total: 900 };
    }, 200);
    expect(res.items.length).toBeLessThan(900);
    expect(calls[0]).toBe(0);
  });
});
