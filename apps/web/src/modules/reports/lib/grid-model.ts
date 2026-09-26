// Client-side sort + per-column filter for the report grid (frappe-datatable
// style). Both work on the rows already loaded; paging happens after them.

import type { ReportColumn, ReportRow } from '@innovic/shared';
import { formatCell, isBlank } from './report-format';

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

function compareValues(a: unknown, b: unknown, numeric: boolean): number {
  if (numeric) return Number(a) - Number(b);
  // Dates arrive as ISO strings, so a plain string compare orders them; text
  // uses a natural compare so "JC-9" sorts before "JC-10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/** Stable sort; blanks always go last, whichever the direction. */
export function sortRows(
  rows: ReportRow[],
  sort: SortState | null,
  numericKeys: ReadonlySet<string>,
): ReportRow[] {
  if (!sort) return rows;
  const numeric = numericKeys.has(sort.key);
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[sort.key];
      const b = y.row[sort.key];
      const ab = isBlank(a);
      const bb = isBlank(b);
      if (ab || bb) return ab === bb ? x.i - y.i : ab ? 1 : -1;
      return sign * compareValues(a, b, numeric) || x.i - y.i;
    })
    .map((p) => p.row);
}

type NumTest = (n: number) => boolean;

/** `>5`, `<5`, `>=5`, `<=5`, `=5` or a bare `5`. Anything else is not a
 *  numeric test and falls back to "contains". */
function parseNumericTest(term: string): NumTest | null {
  const m = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(term.trim());
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case '>':
      return (v) => v > n;
    case '<':
      return (v) => v < n;
    case '>=':
      return (v) => v >= n;
    case '<=':
      return (v) => v <= n;
    default:
      return (v) => v === n;
  }
}

export function filterRows(
  rows: ReportRow[],
  columns: ReportColumn[],
  terms: Readonly<Record<string, string>>,
  numericKeys: ReadonlySet<string>,
): ReportRow[] {
  const tests: ((row: ReportRow) => boolean)[] = [];
  for (const col of columns) {
    const term = (terms[col.key] ?? '').trim();
    if (term === '') continue;
    const numTest = numericKeys.has(col.key) ? parseNumericTest(term) : null;
    if (numTest) {
      tests.push((row) => {
        const v = row[col.key];
        return !isBlank(v) && Number.isFinite(Number(v)) && numTest(Number(v));
      });
      continue;
    }
    const needle = term.toLowerCase();
    tests.push((row) => {
      const v = row[col.key];
      if (isBlank(v)) return false;
      // Match what the user sees (formatted date, status label) or the raw value.
      return (
        formatCell(col, v).toLowerCase().includes(needle) ||
        String(v).toLowerCase().includes(needle)
      );
    });
  }
  if (tests.length === 0) return rows;
  return rows.filter((row) => tests.every((t) => t(row)));
}
