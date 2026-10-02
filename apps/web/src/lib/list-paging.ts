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
  const out: T[] = [];
  for (let offset = 0; offset < EXPORT_CAP; offset += chunk) {
    const res = await fetchPage(chunk, offset);
    out.push(...res.items);
    if (res.items.length < chunk || out.length >= res.total) break;
  }
  return out.slice(0, EXPORT_CAP);
}
