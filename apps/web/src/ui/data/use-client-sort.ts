// Client-side sort model for <DataTable> (ADR-199 Wave A).
//
// This is the OTHER sort model, separate from the server-paginated one that
// SortHeader documents. Use ONE or the other on a given table, never both:
//   - SERVER model: the caller keeps sortBy/sortDir in the URL and re-queries
//     the API on every change — the right choice for a paginated list where the
//     visible page is only part of the data.
//   - CLIENT model (this hook): the rows are already fully loaded (a master that
//     scrolls, a nested line table, a saved-report result). The hook sorts the
//     rows in memory and hands back the sort state to spread onto <DataTable>:
//
//       const { rows, sortBy, sortDir, onSort } = useClientSort(allRows, {
//         accessors: { amount: (r) => r.qty * r.rate },
//         initial: { sortBy: 'code', sortDir: 'asc' },
//       });
//       <DataTable rows={rows} sortBy={sortBy} sortDir={sortDir} onSort={onSort} … />
//
// The three-state cycle (asc → desc → unsorted) is the same nextSort() the
// server model uses, so a column header behaves identically either way.

import { useCallback, useMemo, useState } from 'react';

import { readField } from './data-table-cells';
import { nextSort, type SortDir, type SortState } from './SortHeader';

/** A value the default comparator knows how to order. */
export type SortableValue = string | number | Date | null;

export interface UseClientSortOptions<T> {
  /**
   * Per-field value extractors. Without one, the field is read straight off the
   * row by name (`row[field]`). Use an accessor for a derived or joined value —
   * `amount: (r) => r.qty * r.rate`, `customer: (r) => r.customer?.name ?? null`.
   */
  accessors?: Record<string, (row: T) => SortableValue> | undefined;
  /** The column the table starts sorted on. Omit to start unsorted. */
  initial?: { sortBy: string; sortDir: SortDir } | undefined;
}

export interface UseClientSortResult<T> {
  /** The rows in sorted order (the same array reference while unsorted). */
  rows: T[];
  sortBy: string | undefined;
  sortDir: SortDir | undefined;
  /** Feed a column's `sortField` here — cycles asc → desc → unsorted. */
  onSort: (field: string) => void;
}

/** Coerce any cell value into something the comparator can order. */
function toComparable(v: unknown): SortableValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return String(v);
}

/** Nulls last; numbers numerically; dates by time; everything else by locale. */
function compareValues(a: SortableValue, b: SortableValue): number {
  const aNull = a === null;
  const bNull = b === null;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function useClientSort<T>(
  rows: T[],
  opts?: UseClientSortOptions<T>,
): UseClientSortResult<T> {
  const [sort, setSort] = useState<SortState>(() =>
    opts?.initial ? { sortBy: opts.initial.sortBy, sortDir: opts.initial.sortDir } : {},
  );

  const onSort = useCallback((field: string) => {
    setSort((current) => nextSort(field, current));
  }, []);

  const accessors = opts?.accessors;
  const sorted = useMemo(() => {
    const field = sort.sortBy;
    const dir = sort.sortDir;
    if (!field || !dir) return rows;
    const get = accessors?.[field];
    const sign = dir === 'desc' ? -1 : 1;
    // Decorate with the original index so the sort is STABLE: equal rows keep
    // their incoming order regardless of direction.
    const decorated = rows.map((row, index) => ({
      row,
      index,
      value: get ? get(row) : toComparable(readField(row, field)),
    }));
    decorated.sort((x, y) => {
      const c = compareValues(x.value, y.value);
      return c !== 0 ? c * sign : x.index - y.index;
    });
    return decorated.map((d) => d.row);
  }, [rows, sort.sortBy, sort.sortDir, accessors]);

  return { rows: sorted, sortBy: sort.sortBy, sortDir: sort.sortDir, onSort };
}
