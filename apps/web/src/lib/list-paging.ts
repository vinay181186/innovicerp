// Every list pages at 25 rows (owner decision 2026-10-02, ADR-201): only the
// page on screen is loaded; search / Sort & Filter / filters run on the server
// over ALL rows; any change of those sends the list back to page 1.
//
// One place for the page size, the page maths, the "never past the last page"
// guard and the export helper that fetches EVERY filtered row (an Excel export
// or print register must never contain just the 25 rows on screen).
//
//   const offset = pageOffset(search.page);
//   useList({ …filters, limit: LIST_PAGE_SIZE, offset });
//   useClampPage(search.page, data?.total, (p) => navigate({ search: (s) => ({ ...s, page: p }) }));
//   <ListFooter total={total} page={search.page} pageSize={LIST_PAGE_SIZE} onPage={…} />

import { useEffect } from 'react';
import { z } from 'zod';

/** Rows per page on every list. */
export const LIST_PAGE_SIZE = 25;

/** The `page` search param for a list route: 1-based, bad values read as 1. */
export const pageSearchParam = z.coerce.number().int().positive().catch(1).default(1);

/** Offset of a 1-based page. */
export function pageOffset(page: number, pageSize = LIST_PAGE_SIZE): number {
  return (Math.max(1, Math.floor(page)) - 1) * pageSize;
}

/** Last page for a total (at least 1). */
export function lastPage(total: number, pageSize = LIST_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

/**
 * Rows were deleted / filtered away and the page is now past the end →
 * move to the last page (only once the total is known).
 */
export function useClampPage(
  page: number,
  total: number | undefined,
  onPage: (p: number) => void,
  pageSize = LIST_PAGE_SIZE,
): void {
  useEffect(() => {
    if (total === undefined) return;
    const last = lastPage(total, pageSize);
    if (page > last) onPage(last);
  }, [page, total, pageSize, onPage]);
}

/** Most rows an export will fetch. */
export const EXPORT_CAP = 10_000;

/**
 * Every row matching the list's filters, fetched in 200-row pages (the
 * servers' usual maximum) — for Excel exports and print registers.
 */
export async function fetchAllPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>,
  chunk = 200,
): Promise<T[]> {
  return (await fetchAllPagesCounted(fetchPage, chunk)).items;
}

/**
 * fetchAllPages plus the server's own total (rows matching the filter, before
 * the cap) and a progress callback after every page — for the shared list
 * Export (ADR-310), which says "first 10,000 of N" and counts up on its button.
 */
/** Pages read at once after the first (shared list Export, ADR-310). */
const PARALLEL = 4;

export async function fetchAllPagesCounted<T>(
  fetchPage: (limit: number, offset: number) => Promise<{ items: T[]; total: number }>,
  chunk = 200,
  onProgress?: (fetched: number, total: number) => void,
  cap = EXPORT_CAP,
): Promise<{ items: T[]; total: number }> {
  // Page 1 tells the total; the rest are read PARALLEL pages at a time (in
  // order), not one after another — a 6,000-row log is 30 round trips.
  const first = await fetchPage(chunk, 0);
  const out: T[] = [...first.items];
  let total = first.total;
  onProgress?.(Math.min(out.length, cap), total);
  let offset = chunk;
  let more = first.items.length === chunk && out.length < total;
  while (more && offset < cap) {
    const offsets: number[] = [];
    for (let o = offset; o < Math.min(total, cap) && offsets.length < PARALLEL; o += chunk) {
      offsets.push(o);
    }
    if (offsets.length === 0) break;
    const pages = await Promise.all(offsets.map((o) => fetchPage(chunk, o)));
    for (const res of pages) {
      total = res.total;
      out.push(...res.items);
      if (res.items.length < chunk) more = false;
    }
    onProgress?.(Math.min(out.length, cap), total);
    offset += offsets.length * chunk;
    if (out.length >= total) more = false;
  }
  return { items: out.slice(0, cap), total: Math.max(total, out.length) };
}
