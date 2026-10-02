// Sort & Filter (ADR-200) — the server side of the `sf` list param.
//
// Each list endpoint declares a COLUMN MAP: the fields a screen may sort and
// filter on, each with the SQL expression the list SELECT shows for it and its
// type. This helper turns the parsed `sf` into a WHERE fragment (AND-ed onto
// the endpoint's existing WHERE, so company + soft-delete + every existing
// filter still apply) and an ORDER BY. A field that is not in the map is a 400
// — the map IS the whitelist; values are always bound parameters.
//
//   const where = sfWhere(JC_SF_COLUMNS, input.sf);          // `AND …` or empty
//   const order = sfOrderBy(JC_SF_COLUMNS, input.sf, sql`jc.jc_date DESC, jc.code DESC`);
//   … WHERE jc.company_id = … ${where} ORDER BY ${order} LIMIT …

import { sql, type SQL } from 'drizzle-orm';
import {
  SF_BLANK,
  sfDateRange,
  sfParamSchema,
  sfTodayIst,
  type SfFilter,
  type SfQuery,
} from '@innovic/shared';

import { ValidationError } from './errors';

/**
 *   text  matched as text (contains / equals / begins / tick list of values)
 *   num   numeric comparisons
 *   date  a calendar DATE expression (for a timestamptz pass
 *         `(x AT TIME ZONE 'Asia/Kolkata')::date` so days are India days)
 *   list  a stored code (status / type) — tick list of exact values
 */
export type SfColumnType = 'text' | 'num' | 'date' | 'list';

export interface SfColumnDef {
  /** The SAME expression the list SELECT shows for this column. */
  sql: SQL;
  type: SfColumnType;
  /** A money column — only for users who may see prices. */
  price?: boolean;
}

export type SfColumnMap = Readonly<Record<string, SfColumnDef>>;

export interface SfOptions {
  /** False → money columns cannot be sorted / filtered (they could be guessed). */
  canSeePrice?: boolean;
}

/** Escape ILIKE metacharacters in a user's term; pair with ESCAPE '\'. */
export function likeEscape(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function column(map: SfColumnMap, field: string, opts: SfOptions | undefined): SfColumnDef {
  const def = Object.prototype.hasOwnProperty.call(map, field) ? map[field] : undefined;
  if (!def) throw new ValidationError(`This list cannot be sorted or filtered by "${field}".`);
  // Fails closed: a money column needs the caller to say the user may see prices.
  if (def.price && opts?.canSeePrice !== true) {
    throw new ValidationError(`You cannot sort or filter by "${field}".`);
  }
  return def;
}

function blankCheck(expr: SQL): SQL {
  return sql`(${expr} IS NULL OR btrim(${expr}::text) = '')`;
}

function filterSql(def: SfColumnDef, f: SfFilter, today: string): SQL | null {
  const e = def.sql;
  switch (f.kind) {
    case 'values': {
      // A tick list is of stored codes / texts — a number or date column's
      // ::text form never equals what the screen shows.
      if (def.type !== 'list' && def.type !== 'text')
        throw new ValidationError('A tick-list filter needs a text or list column.');
      const real = f.values.filter((v) => v !== SF_BLANK);
      const blank = f.values.includes(SF_BLANK);
      const parts: SQL[] = [];
      if (real.length > 0) {
        parts.push(
          sql`${e}::text IN (${sql.join(
            real.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        );
      }
      if (blank) parts.push(blankCheck(e));
      // Nothing ticked → nothing matches (as in Excel).
      return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`FALSE`;
    }
    case 'text': {
      // A list column stores codes ('qc_pending'), not the labels shown.
      if (def.type !== 'text') throw new ValidationError('A text filter needs a text column.');
      const q = f.q.trim();
      if (q === '') return null;
      if (f.op === 'equals') return sql`lower(${e}::text) = lower(${q})`;
      if (f.op === 'begins') return sql`${e}::text ILIKE ${`${likeEscape(q)}%`} ESCAPE '\\'`;
      const pat = `%${likeEscape(q)}%`;
      if (f.op === 'notContains')
        return sql`(${e} IS NULL OR ${e}::text NOT ILIKE ${pat} ESCAPE '\\')`;
      return sql`${e}::text ILIKE ${pat} ESCAPE '\\'`;
    }
    case 'num': {
      if (def.type !== 'num') throw new ValidationError('A number filter needs a number column.');
      // Bound as ::numeric — an untyped parameter takes the column's type, so
      // "> 2.5" on an integer column would be a database error.
      const a = f.a;
      switch (f.op) {
        case 'eq':
          return sql`${e} = ${a}::numeric`;
        case 'ne':
          return sql`${e} <> ${a}::numeric`;
        case 'gt':
          return sql`${e} > ${a}::numeric`;
        case 'gte':
          return sql`${e} >= ${a}::numeric`;
        case 'lt':
          return sql`${e} < ${a}::numeric`;
        case 'lte':
          return sql`${e} <= ${a}::numeric`;
        case 'between': {
          const b = f.b ?? a;
          return sql`${e} BETWEEN ${Math.min(a, b)}::numeric AND ${Math.max(a, b)}::numeric`;
        }
      }
      return null;
    }
    case 'date': {
      if (def.type !== 'date') throw new ValidationError('A date filter needs a date column.');
      const { from, to } = sfDateRange(f.op, f.from, f.to, today);
      const parts: SQL[] = [];
      if (from) parts.push(sql`${e} >= ${from}::date`);
      if (to) parts.push(sql`${e} <= ${to}::date`);
      return parts.length > 0 ? sql`(${sql.join(parts, sql` AND `)})` : null;
    }
  }
}

/** `AND (…) AND (…)` for every filter, or an empty fragment. */
export function sfWhere(map: SfColumnMap, q: SfQuery | undefined, opts?: SfOptions): SQL {
  if (!q || q.filters.length === 0) return sql``;
  const today = sfTodayIst();
  const parts: SQL[] = [];
  for (const f of q.filters) {
    const piece = filterSql(column(map, f.field, opts), f, today);
    if (piece) parts.push(piece);
  }
  return parts.length > 0 ? sql`AND ${sql.join(parts, sql` AND `)}` : sql``;
}

/**
 * The ORDER BY list: the chosen column (blanks last either way) and then the
 * endpoint's own order as the tie-breaker, so paging stays stable.
 */
export function sfOrderBy(
  map: SfColumnMap,
  q: SfQuery | undefined,
  fallback: SQL,
  opts?: SfOptions,
): SQL {
  if (!q?.sort) return fallback;
  const def = column(map, q.sort.field, opts);
  const dir = q.sort.dir === 'desc' ? sql`DESC` : sql`ASC`;
  return sql`${def.sql} ${dir} NULLS LAST, ${fallback}`;
}

/** The endpoint's raw `sf` string → SfQuery; a malformed one is a 400. */
export function readSf(raw: string | undefined): SfQuery | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = sfParamSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('The sort / filter could not be read.');
  return parsed.data;
}
