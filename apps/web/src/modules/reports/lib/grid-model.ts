// Report grid sort state. The sort itself — and the column filters — run on
// the SERVER over every row of the report (ADR-201, apps/api reports/grid.ts);
// the browser only holds which column is sorted which way.

export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: string;
  dir: SortDir;
}

/** Header click cycle: none → asc → desc → none. */
export function nextSort(cur: SortState | null, key: string): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: 'asc' };
  if (cur.dir === 'asc') return { key, dir: 'desc' };
  return null;
}
