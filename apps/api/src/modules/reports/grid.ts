// Report grid on the SERVER (ADR-201, 2026-10-02). Every report pages at 25
// rows: the definition still runs its own hand-written SQL unchanged and
// returns its whole (capped) result; this module then applies the grid's
// column filters and sort over ALL those rows, works out the totals row over
// ALL matching rows, and hands back only the page asked for. The browser no
// longer receives — or sums — anything but the 25 rows on screen.
//
// Same rules the web grid used to run on loaded rows (reports/lib/grid-model
// + report-format), moved here so a row on page 3 is found from page 1:
//   • sort: stable, blanks last in either direction, numbers numerically,
//     text with a natural compare ("JC-9" before "JC-10"); no sort = the
//     report's own SQL order.
//   • column filter: on a number column `>5` `<5` `>=5` `<=5` `=5` or a bare
//     number; anything else is "contains" (case-insensitive) on the raw value
//     or the words the grid shows (26-Sep-2026 for a date, "In Progress" for
//     a status code).
//   • totals: a numeric column whose key/label names an additive measure.

import {
  REPORT_COLUMN_FILTER_PREFIX,
  REPORT_GRID_PARAM_PREFIX,
  type ReportColumn,
  type ReportRow,
} from '@innovic/shared';

export interface GridParams {
  limit?: number;
  offset: number;
  sort?: { key: string; dir: 'asc' | 'desc' };
  /** column key → term */
  colFilters: Record<string, string>;
}

/** Most rows one page may ask for (exports leave `_limit` out). */
const MAX_LIMIT = 1000;

/** Split the raw query into the report's own filters and the grid params.
 *  Every `_`-prefixed key is a grid key and never reaches the report. */
export function splitGridParams(raw: Record<string, string>): {
  filters: Record<string, string>;
  grid: GridParams;
} {
  const filters: Record<string, string> = {};
  const colFilters: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith(REPORT_COLUMN_FILTER_PREFIX)) {
      const key = k.slice(REPORT_COLUMN_FILTER_PREFIX.length);
      if (key && v.trim() !== '') colFilters[key] = v;
    } else if (!k.startsWith(REPORT_GRID_PARAM_PREFIX)) {
      filters[k] = v;
    }
  }
  const int = (v: string | undefined): number | undefined => {
    if (v === undefined || !/^\d+$/.test(v)) return undefined;
    return Number(v);
  };
  const limit = int(raw['_limit']);
  const sortKey = raw['_sort'];
  return {
    filters,
    grid: {
      ...(limit !== undefined ? { limit: Math.min(Math.max(limit, 1), MAX_LIMIT) } : {}),
      offset: int(raw['_offset']) ?? 0,
      ...(sortKey ? { sort: { key: sortKey, dir: raw['_dir'] === 'desc' ? 'desc' : 'asc' } } : {}),
      colFilters,
    },
  };
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/** Server-typed `number`, or an untyped (`text`) column whose every non-empty
 *  value is a JS number — judged over ALL rows. */
export function numericKeysOf(columns: ReportColumn[], rows: ReportRow[]): Set<string> {
  const out = new Set<string>();
  for (const col of columns) {
    if (col.type === 'number') {
      out.add(col.key);
      continue;
    }
    if (col.type !== 'text') continue;
    let seen = false;
    let ok = true;
    for (const r of rows) {
      const v = r[col.key];
      if (isBlank(v)) continue;
      if (typeof v !== 'number') {
        ok = false;
        break;
      }
      seen = true;
    }
    if (ok && seen) out.add(col.key);
  }
  return out;
}

const SUM_WORDS = /(qty|quantity|pcs|amount|amt|value|total|hours|hrs|count|weight|kg)/i;
const NO_SUM_WORDS =
  /(\bid\b|_id$|code|\bno\.?$|_no$|rate|price|%|pct|percent|avg|average|days|ratio)/i;

function isSummable(col: ReportColumn, rows: ReportRow[]): boolean {
  const name = `${col.key} ${col.label}`;
  if (!SUM_WORDS.test(name) || NO_SUM_WORDS.test(name)) return false;
  return rows.every((r) => isBlank(r[col.key]) || Number.isFinite(Number(r[col.key])));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The words the grid shows for a cell, for "contains" matching. */
function shownText(col: ReportColumn, v: unknown): string {
  const s = String(v);
  if (col.type === 'date' || col.type === 'datetime') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
    if (m && mon) return `${m[3]}-${mon}-${m[1]}`;
  }
  // Status / type codes show as words (in_progress → in progress).
  if (/(status$|(^|_)type$)/i.test(col.key)) return s.replace(/_/g, ' ');
  return s;
}

type NumTest = (n: number) => boolean;
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

function filterRows(
  rows: ReportRow[],
  columns: ReportColumn[],
  terms: Record<string, string>,
  numericKeys: Set<string>,
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
      return (
        String(v).toLowerCase().includes(needle) || shownText(col, v).toLowerCase().includes(needle)
      );
    });
  }
  if (tests.length === 0) return rows;
  return rows.filter((row) => tests.every((t) => t(row)));
}

function sortRows(
  rows: ReportRow[],
  sort: GridParams['sort'],
  numericKeys: Set<string>,
): ReportRow[] {
  if (!sort) return rows;
  const numeric = numericKeys.has(sort.key);
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: unknown, b: unknown): number =>
    numeric
      ? Number(a) - Number(b)
      : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  // The original index breaks every tie, so the order is the same on every
  // page request (the report's SQL order is the final tie-breaker).
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[sort.key];
      const b = y.row[sort.key];
      const ab = isBlank(a);
      const bb = isBlank(b);
      if (ab || bb) return ab === bb ? x.i - y.i : ab ? 1 : -1;
      return sign * cmp(a, b) || x.i - y.i;
    })
    .map((p) => p.row);
}

export interface GridResult {
  rows: ReportRow[];
  rowCount: number;
  unfilteredCount: number;
  offset: number;
  totals: Record<string, number>;
  numericKeys: string[];
}

/** Column filters → sort → totals over every match → the page. */
export function applyGrid(
  columns: ReportColumn[],
  allRows: ReportRow[],
  grid: GridParams,
): GridResult {
  const numericKeys = numericKeysOf(columns, allRows);
  const known = new Set(columns.map((c) => c.key));
  const sort = grid.sort && known.has(grid.sort.key) ? grid.sort : undefined;
  const filtered = filterRows(allRows, columns, grid.colFilters, numericKeys);
  const sorted = sortRows(filtered, sort, numericKeys);

  const totals: Record<string, number> = {};
  for (const c of columns) {
    if (!numericKeys.has(c.key) || !isSummable(c, filtered)) continue;
    totals[c.key] = filtered.reduce((s, r) => s + (isBlank(r[c.key]) ? 0 : Number(r[c.key])), 0);
  }

  const offset = grid.limit === undefined ? 0 : Math.min(grid.offset, sorted.length);
  const rows = grid.limit === undefined ? sorted : sorted.slice(offset, offset + grid.limit);
  return {
    rows,
    rowCount: sorted.length,
    unfilteredCount: allRows.length,
    offset,
    totals,
    numericKeys: [...numericKeys],
  };
}
