// Sort & Filter (ADR-200) — the pure model behind the ▾ column menu.
//
// A table cell is reduced to its DISPLAYED text (what the user reads), then
// typed by the column: a number, a calendar date (YYYY-MM-DD), or text. The
// user's choice per column is one ColumnFilter; the table holds at most one
// sort. Everything here is pure, so it is unit-tested without a browser
// (filter-model.test.ts) and the server mode can reuse the same names.

import { sfDateRange, sfPresetRange } from '@innovic/shared';

export type SfType = 'text' | 'num' | 'date' | 'list';
export type SortDir = 'asc' | 'desc';

export type TextOp = 'contains' | 'notContains' | 'equals' | 'begins';
export type NumOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth';
export type DateOp = 'on' | 'before' | 'after' | 'between' | DatePreset;

/** One column's filter. `values` is Excel's tick list (display texts, BLANK for empty cells). */
export type ColumnFilter =
  | { kind: 'values'; values: string[] }
  | { kind: 'text'; op: TextOp; q: string }
  | { kind: 'num'; op: NumOp; a: number; b?: number | undefined }
  | { kind: 'date'; op: DateOp; from?: string | undefined; to?: string | undefined };

export interface SortSpec {
  id: string;
  dir: SortDir;
}

export interface SfState {
  sort: SortSpec | null;
  filters: Record<string, ColumnFilter>;
}

export const EMPTY_STATE: SfState = { sort: null, filters: {} };

/** The tick-list entry for an empty cell. */
export const BLANK = '(Blanks)';

/** What an empty cell looks like on screen — the quiet dash counts as empty. */
const BLANK_TEXT = /^[\s—–-]*$/;

export function normText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return BLANK_TEXT.test(s) ? null : s;
}

// ── typing a displayed value ────────────────────────────────────────────────

/** "1,250.50", "₹ 1,250", "12 Nos", "-3" → the number; null when the text does not start with one. */
export function parseNum(s: string | null): number | null {
  if (s === null) return null;
  const m = /^[^\d-]{0,3}(-?\d[\d,]*(?:\.\d+)?)/.exec(s.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const MON: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad2 = (n: number): string => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null; // 31-Feb
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * A displayed date → `YYYY-MM-DD`. Reads the app's format `26-Sep-2026`
 * (optionally followed by a time), `26-09-2026`, `26/09/2026` and ISO
 * `2026-09-26`. Anything else is null.
 */
export function parseDate(s: string | null): string | null {
  if (s === null) return null;
  const t = s.trim();
  let m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})(?:\b|$)/.exec(t);
  if (m?.[1] && m[2] && m[3]) {
    const mon = MON[m[2].toLowerCase()];
    return mon ? ymd(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\b|$)/.exec(t);
  if (m?.[1] && m[2] && m[3]) return ymd(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})(?:\b|T|$)/.exec(t);
  if (m?.[1] && m[2] && m[3]) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Only these look like a pure number for type detection (no "12 Nos"). */
const PURE_NUM = /^[₹$]?\s?-?\d[\d,]*(\.\d+)?%?$/;

/**
 * The filter type of a column from its engine kind and its displayed values:
 * a date column is one whose every non-blank value reads as a date (even if
 * the screen did not mark it `date`); a number column is `num` or all pure
 * numbers; a status chip is a tick list only.
 */
export function detectType(kind: string | undefined, values: Array<string | null>): SfType {
  const present = values.filter((v): v is string => v !== null);
  if (kind === 'badge') return 'list';
  if (present.length === 0) return kind === 'num' ? 'num' : 'text';
  const sample = present.length > 400 ? present.slice(0, 400) : present;
  if (kind === 'date' || sample.every((v) => parseDate(v) !== null)) {
    if (sample.every((v) => parseDate(v) !== null)) return 'date';
  }
  if (kind === 'num') {
    if (sample.every((v) => parseNum(v) !== null)) return 'num';
  } else if (sample.every((v) => PURE_NUM.test(v))) {
    return 'num';
  }
  return 'text';
}

// ── dates (India time) ──────────────────────────────────────────────────────

/** Inclusive [from, to] of a preset, counted from `today` (an IST `YYYY-MM-DD`). */
export function presetRange(p: DatePreset, today: string): [string, string] {
  return sfPresetRange(p, today);
}

export const DATE_PRESETS: Array<{ op: DatePreset; label: string }> = [
  { op: 'today', label: 'Today' },
  { op: 'yesterday', label: 'Yesterday' },
  { op: 'thisWeek', label: 'This week' },
  { op: 'lastWeek', label: 'Last week' },
  { op: 'thisMonth', label: 'This month' },
  { op: 'lastMonth', label: 'Last month' },
];

// ── matching ────────────────────────────────────────────────────────────────

/** Does one cell (its displayed text) pass the column's filter? */
export function matches(f: ColumnFilter, text: string | null, today: string): boolean {
  switch (f.kind) {
    case 'values':
      return f.values.includes(text ?? BLANK);
    case 'text': {
      const q = f.q.trim().toLowerCase();
      if (q === '') return true;
      const v = (text ?? '').toLowerCase();
      if (f.op === 'contains') return v.includes(q);
      if (f.op === 'notContains') return !v.includes(q);
      if (f.op === 'begins') return v.startsWith(q);
      return v === q;
    }
    case 'num': {
      const n = parseNum(text);
      if (n === null) return false;
      const { a, b } = f;
      if (f.op === 'eq') return n === a;
      if (f.op === 'ne') return n !== a;
      if (f.op === 'gt') return n > a;
      if (f.op === 'gte') return n >= a;
      if (f.op === 'lt') return n < a;
      if (f.op === 'lte') return n <= a;
      const hi = b ?? a;
      return n >= Math.min(a, hi) && n <= Math.max(a, hi);
    }
    case 'date': {
      const d = parseDate(text);
      if (d === null) return false;
      // The same range the server applies (packages/shared list-query.ts).
      const { from, to } = sfDateRange(f.op, f.from, f.to, today);
      return (!from || d >= from) && (!to || d <= to);
    }
  }
}

/** Is this filter complete enough to apply? (An empty contains / a range with no ends is not.) */
export function isUsable(f: ColumnFilter): boolean {
  if (f.kind === 'text') return f.q.trim() !== '';
  if (f.kind === 'num')
    return (
      Number.isFinite(f.a) && (f.op !== 'between' || f.b === undefined || Number.isFinite(f.b))
    );
  if (f.kind === 'date') {
    if (f.op === 'between') return !!(f.from || f.to);
    if (f.op === 'on' || f.op === 'before' || f.op === 'after') return !!f.from;
    return true;
  }
  return true;
}

// ── ordering ────────────────────────────────────────────────────────────────

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Blanks always last, whichever way the column is sorted. */
export function compareTyped(a: string | null, b: string | null, type: SfType): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (type === 'num') {
    const x = parseNum(a);
    const y = parseNum(b);
    if (x !== null && y !== null && x !== y) return x - y;
  } else if (type === 'date') {
    const x = parseDate(a);
    const y = parseDate(b);
    if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
  }
  return collator.compare(a, b);
}

/** The tick list for a column: its distinct displayed values, sorted, blanks last. */
export function distinctValues(texts: Array<string | null>, type: SfType): string[] {
  const set = new Set<string>();
  let blank = false;
  for (const t of texts) {
    if (t === null) blank = true;
    else set.add(t);
  }
  const out = [...set].sort((a, b) => compareTyped(a, b, type));
  if (blank) out.push(BLANK);
  return out;
}

export interface SfColumn {
  id: string;
  type: SfType;
  /** Displayed text of every row, in the incoming row order. */
  texts: Array<string | null>;
}

/**
 * The visible row indexes after every filter, in sort order. Stable: equal
 * rows keep their incoming order. Filters on a column that no longer exists
 * are ignored (a saved filter outliving a column is not an error).
 */
export function applySortFilter(
  rowCount: number,
  cols: Map<string, SfColumn>,
  state: SfState,
  today: string,
): number[] {
  const active = Object.entries(state.filters).filter(([id, f]) => cols.has(id) && isUsable(f));
  let idx: number[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    let ok = true;
    for (const [id, f] of active) {
      if (!matches(f, cols.get(id)?.texts[i] ?? null, today)) {
        ok = false;
        break;
      }
    }
    if (ok) idx.push(i);
  }
  const sortCol = state.sort ? cols.get(state.sort.id) : undefined;
  if (state.sort && sortCol) {
    const sign = state.sort.dir === 'desc' ? -1 : 1;
    const t = sortCol.texts;
    idx = idx.sort((x, y) => {
      const a = t[x] ?? null;
      const b = t[y] ?? null;
      // Blanks stay last in BOTH directions, as in Excel.
      if (a === null || b === null) return a === b ? x - y : a === null ? 1 : -1;
      const c = compareTyped(a, b, sortCol.type);
      return c !== 0 ? c * sign : x - y;
    });
  }
  return idx;
}

/** How many columns carry a filter that is applied. */
export function activeFilterCount(state: SfState): number {
  return Object.values(state.filters).filter(isUsable).length;
}

/** Drop unusable / malformed entries from a stored state (sessionStorage is not trusted). */
const TEXT_OPS: readonly string[] = ['contains', 'notContains', 'equals', 'begins'];
const NUM_OPS: readonly string[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between'];
const DATE_OPS: readonly string[] = [
  'on',
  'before',
  'after',
  'between',
  ...DATE_PRESETS.map((d) => d.op),
];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdOrUndef = (v: unknown): string | undefined =>
  typeof v === 'string' && YMD.test(v) ? v : undefined;

export function sanitizeState(raw: unknown): SfState {
  if (!raw || typeof raw !== 'object') return EMPTY_STATE;
  const r = raw as { sort?: unknown; filters?: unknown };
  let sort: SortSpec | null = null;
  const s = r.sort as Partial<SortSpec> | null | undefined;
  if (s && typeof s.id === 'string' && (s.dir === 'asc' || s.dir === 'desc')) {
    sort = { id: s.id, dir: s.dir };
  }
  const filters: Record<string, ColumnFilter> = {};
  if (r.filters && typeof r.filters === 'object') {
    for (const [id, f] of Object.entries(r.filters as Record<string, unknown>)) {
      const c = f as Partial<ColumnFilter> & Record<string, unknown>;
      if (!c || typeof c !== 'object') continue;
      if (
        c.kind === 'values' &&
        Array.isArray(c.values) &&
        c.values.every((v) => typeof v === 'string')
      )
        filters[id] = { kind: 'values', values: c.values as string[] };
      else if (c.kind === 'text' && typeof c.q === 'string' && TEXT_OPS.includes(String(c.op)))
        filters[id] = { kind: 'text', op: c.op as TextOp, q: c.q };
      else if (
        c.kind === 'num' &&
        typeof c.a === 'number' &&
        Number.isFinite(c.a) &&
        NUM_OPS.includes(String(c.op))
      )
        filters[id] = {
          kind: 'num',
          op: c.op as NumOp,
          a: c.a,
          b: typeof c.b === 'number' ? c.b : undefined,
        };
      else if (c.kind === 'date' && DATE_OPS.includes(String(c.op)))
        filters[id] = {
          kind: 'date',
          op: c.op as DateOp,
          from: ymdOrUndef(c.from),
          to: ymdOrUndef(c.to),
        };
    }
  }
  return { sort, filters };
}
