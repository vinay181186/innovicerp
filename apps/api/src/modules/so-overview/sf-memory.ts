// Sort & Filter (ADR-200) + 25-row paging (ADR-201) for lists whose rows are
// WORKED OUT on the server in code (SO Overview's progress roll-up, SO
// Planning's coverage %), so there is no SQL expression to hand to sfWhere.
// The server still holds every row: it filters, sorts and pages them here and
// sends the browser only the page. The rules mirror lib/list-query.ts exactly
// (same ops, same blanks, same date presets, a field outside the map is a
// 400), so a filter means the same thing on every list.

import { SF_BLANK, sfDateRange, sfTodayIst, type SfFilter, type SfQuery } from '@innovic/shared';

import type { SfColumnType } from '../../lib/list-query';
import { ValidationError } from '../../lib/errors';

export interface MemField<T> {
  type: SfColumnType;
  /** The value the cell shows (a stored code for `list`). */
  get: (row: T) => string | number | null | undefined;
}

export type MemFieldMap<T> = Readonly<Record<string, MemField<T>>>;

function field<T>(map: MemFieldMap<T>, name: string): MemField<T> {
  const def = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
  if (!def) throw new ValidationError(`This list cannot be sorted or filtered by "${name}".`);
  return def;
}

const isBlank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

function matcher<T>(def: MemField<T>, f: SfFilter, today: string): ((row: T) => boolean) | null {
  switch (f.kind) {
    case 'values': {
      if (def.type !== 'list' && def.type !== 'text')
        throw new ValidationError('A tick-list filter needs a text or list column.');
      const real = new Set(f.values.filter((v) => v !== SF_BLANK));
      const blank = f.values.includes(SF_BLANK);
      return (r) => {
        const v = def.get(r);
        if (isBlank(v)) return blank;
        return real.has(String(v));
      };
    }
    case 'text': {
      if (def.type !== 'text') throw new ValidationError('A text filter needs a text column.');
      const q = f.q.trim().toLowerCase();
      if (q === '') return null;
      return (r) => {
        const v = def.get(r);
        const s = isBlank(v) ? null : String(v).toLowerCase();
        if (f.op === 'notContains') return s === null || !s.includes(q);
        if (s === null) return false;
        if (f.op === 'equals') return s === q;
        if (f.op === 'begins') return s.startsWith(q);
        return s.includes(q);
      };
    }
    case 'num': {
      if (def.type !== 'num') throw new ValidationError('A number filter needs a number column.');
      const a = f.a;
      const b = f.b ?? a;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return (r) => {
        const raw = def.get(r);
        if (isBlank(raw)) return false;
        const n = Number(raw);
        if (!Number.isFinite(n)) return false;
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
          case 'between':
            return n >= lo && n <= hi;
        }
        return true;
      };
    }
    case 'date': {
      if (def.type !== 'date') throw new ValidationError('A date filter needs a date column.');
      const { from, to } = sfDateRange(f.op, f.from, f.to, today);
      if (!from && !to) return null;
      return (r) => {
        const v = def.get(r);
        if (isBlank(v)) return false;
        const d = String(v).slice(0, 10);
        return (!from || d >= from) && (!to || d <= to);
      };
    }
  }
}

/** Rows matching every filter (input order kept). */
export function sfFilterRows<T>(rows: T[], map: MemFieldMap<T>, q: SfQuery | undefined): T[] {
  if (!q || q.filters.length === 0) return rows;
  const today = sfTodayIst();
  const tests = q.filters
    .map((f) => matcher(field(map, f.field), f, today))
    .filter((t): t is (row: T) => boolean => t !== null);
  if (tests.length === 0) return rows;
  return rows.filter((r) => tests.every((t) => t(r)));
}

/**
 * Rows sorted by the chosen field, blanks last either way; ties keep the
 * input order (the list's own order — Array.prototype.sort is stable), so
 * paging never skips or repeats a row.
 */
export function sfSortRows<T>(rows: T[], map: MemFieldMap<T>, q: SfQuery | undefined): T[] {
  if (!q?.sort) return rows;
  const def = field(map, q.sort.field);
  const dir = q.sort.dir === 'desc' ? -1 : 1;
  const key = (r: T): string | number | null => {
    const v = def.get(r);
    if (isBlank(v)) return null;
    if (def.type === 'num') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return def.type === 'date' ? String(v).slice(0, 10) : String(v).toLowerCase();
  };
  const keyed = rows.map((r, i) => ({ r, i, k: key(r) }));
  keyed.sort((x, y) => {
    if (x.k === null || y.k === null) {
      if (x.k === y.k) return x.i - y.i;
      return x.k === null ? 1 : -1;
    }
    if (x.k < y.k) return -dir;
    if (x.k > y.k) return dir;
    return x.i - y.i;
  });
  return keyed.map((e) => e.r);
}

/** One page of rows; no limit → every row (callers that never paged). */
export function pageRows<T>(rows: T[], limit: number | undefined, offset: number | undefined): T[] {
  if (limit === undefined) return rows;
  const start = Math.max(0, offset ?? 0);
  return rows.slice(start, start + limit);
}
