import { describe, expect, it } from 'vitest';

import { fetchAllPages, lastPage, pageOffset, pageSearchParam } from './list-paging';

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
});
