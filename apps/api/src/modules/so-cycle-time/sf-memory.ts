// Sort & Filter (ADR-200) over rows already worked out in TypeScript — for a
// report whose figures are computed per row after the query (SO Cycle Time's
// phase durations come from lib/so-phase-data.ts, not from SQL), so the SQL
// column map of lib/list-query.ts cannot reach them. Same operators and the
// same meaning as the SQL helper: text = case-insensitive contains / equals /
// begins / not-contains, a blank never passes a number / date test (SQL NULL),
// a tick list matches the stored value, sort puts blanks last either way.

import { SF_BLANK, sfDateRange, sfTodayIst, type SfFilter, type SfQuery } from '@innovic/shared';
import { ValidationError } from '../../lib/errors';

export type MemSfType = 'text' | 'num' | 'date' | 'list';

export interface MemSfColumn<T> {
  type: MemSfType;
  /** The value the screen shows for the column (a date as `YYYY-MM-DD…`). */
  get: (row: T) => string | number | null;
}

export type MemSfColumnMap<T> = Readonly<Record<string, MemSfColumn<T>>>;

function column<T>(map: MemSfColumnMap<T>, field: string): MemSfColumn<T> {
  const def = Object.prototype.hasOwnProperty.call(map, field) ? map[field] : undefined;
  if (!def) throw new ValidationError(`This list cannot be sorted or filtered by "${field}".`);
  return def;
}

const isBlank = (v: string | number | null): boolean => v === null || String(v).trim() === '';

function passes<T>(def: MemSfColumn<T>, f: SfFilter, row: T, today: string): boolean {
  const v = def.get(row);
  switch (f.kind) {
    case 'values': {
      if (def.type !== 'list' && def.type !== 'text')
        throw new ValidationError('A tick-list filter needs a text or list column.');
      if (f.values.includes(SF_BLANK) && isBlank(v)) return true;
      return v !== null && f.values.includes(String(v));
    }
    case 'text': {
      if (def.type !== 'text') throw new ValidationError('A text filter needs a text column.');
      const q = f.q.trim().toLowerCase();
      if (q === '') return true;
      const s = v === null ? null : String(v).toLowerCase();
      if (f.op === 'notContains') return s === null || !s.includes(q);
      if (s === null) return false;
      if (f.op === 'equals') return s === q;
      if (f.op === 'begins') return s.startsWith(q);
      return s.includes(q);
    }
    case 'num': {
      if (def.type !== 'num') throw new ValidationError('A number filter needs a number column.');
      if (v === null) return false;
      const n = Number(v);
      const a = f.a;
      switch (f.op) {
        case 'eq':
          return n === a;
        case 'ne':
          return n !== a;
        case 'gt':
          return n > a;
        case 'gte':
          return n >= a;
        case 'lt':
          return n < a;
        case 'lte':
          return n <= a;
        case 'between': {
          const b = f.b ?? a;
          return n >= Math.min(a, b) && n <= Math.max(a, b);
        }
      }
      return true;
    }
    case 'date': {
      if (def.type !== 'date') throw new ValidationError('A date filter needs a date column.');
      const { from, to } = sfDateRange(f.op, f.from, f.to, today);
      if (!from && !to) return true;
      if (v === null) return false;
      const d = String(v).slice(0, 10);
      return (!from || d >= from) && (!to || d <= to);
    }
  }
}

/** The rows passing every filter (none → all rows). */
export function memSfFilter<T>(rows: T[], map: MemSfColumnMap<T>, q: SfQuery | undefined): T[] {
  if (!q || q.filters.length === 0) return rows;
  const today = sfTodayIst();
  const defs = q.filters.map((f) => [column(map, f.field), f] as const);
  return rows.filter((r) => defs.every(([def, f]) => passes(def, f, r, today)));
}

/** Sorted by the chosen column (blanks last), then `fallback` as the tie-break. */
export function memSfSort<T>(
  rows: T[],
  map: MemSfColumnMap<T>,
  q: SfQuery | undefined,
  fallback: (a: T, b: T) => number,
): T[] {
  const sort = q?.sort;
  if (!sort) return [...rows].sort(fallback);
  const def = column(map, sort.field);
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = def.get(a);
    const vb = def.get(b);
    const ba = isBlank(va);
    const bb = isBlank(vb);
    if (ba || bb) return ba && bb ? fallback(a, b) : ba ? 1 : -1;
    let c: number;
    if (def.type === 'num') c = Number(va) - Number(vb);
    else c = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    return c !== 0 ? c * dir : fallback(a, b);
  });
}
