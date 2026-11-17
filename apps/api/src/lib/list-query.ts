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
  /** Optional ORDER BY expression when the shown text does not sort in time order
   *  (a 12-hour clock '01:05 PM' sorts before '11:00 AM' as text). Filter still uses `sql`. */
  sortSql?: SQL;
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
  return sql`${def.sortSql ?? def.sql} ${dir} NULLS LAST, ${fallback}`;
}

/** The endpoint's raw `sf` string → SfQuery; a malformed one is a 400. */
export function readSf(raw: string | undefined): SfQuery | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = sfParamSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError('The sort / filter could not be read.');
  return parsed.data;
}

// ─── ADR-303 — line facts on a one-row-per-document list ────────────────────
//
// A document list (PO, GRN, OSP DC, Invoice, Dispatch, JW DC, CMR …) prints a
// LINE fact in a column — SO No., Internal SO No., JC No. — as the first line's
// value, and its ▾ filter (and the SO dropdown, ADR-267) must judge the WHOLE
// document, never multiply it into one row per line. `liftLineFilters` takes
// those filters out of `sf` and answers each as its own predicate over the
// document's value set = its header value (when the field has one) plus the
// value on every live line:
//
//   positive (contains / equals / begins, a tick list's values, number / date
//             comparisons)        → the header OR ANY live line matches;
//   negative (notContains, num ne) → NOT (the positive match): neither the
//             header nor any live line matches;
//   (Blanks) in a tick list       → no non-blank value anywhere — a document
//             with no lines and no header value included. A tick list without
//             (Blanks) ticked is the "non-blank" side: some value is in the list.
//
// Filters are AND-ed, one predicate each. The sort stays in `docSf` — the
// document map sorts the field on its first-line value.

/** One line fact a document list filters by. */
export interface SfLiftedField {
  /** The value on ONE line, over the aliases `linesFrom` declares. */
  line: SQL;
  /** The document's own value for the same fact (OR-ed with its lines), over
   *  the outer query's aliases. Omit when the header carries none. */
  header?: SQL;
  type: SfColumnType;
  price?: boolean;
}

export interface SfLiftSpec {
  fields: Readonly<Record<string, SfLiftedField>>;
  /** `FROM <line table> <joins> WHERE <line of THIS document, live>` — the
   *  helper appends `AND <match>` inside an EXISTS. */
  linesFrom: SQL;
}

export interface LiftedSf {
  /** `sf` without the lifted filters (sort kept) — feed it to the document map. */
  docSf: SfQuery | undefined;
  /** `AND (…) AND (…)` — one predicate per lifted filter; empty when none.
   *  AND it onto the list AND every count / summary WHERE. */
  lineFrag: SQL;
  /** True when at least one filter was lifted (the count may need the joins
   *  a `header` expression reads). */
  lifted: boolean;
}

function nonBlank(expr: SQL): SQL {
  return sql`(${expr} IS NOT NULL AND btrim(${expr}::text) <> '')`;
}

function liftedPredicate(
  def: SfLiftedField,
  f: SfFilter,
  linesFrom: SQL,
  today: string,
): SQL | null {
  // Validates the filter kind against the type, and drops an empty filter.
  if (f.kind !== 'values' && filterSql({ sql: def.line, type: def.type }, f, today) === null)
    return null;
  const anyMatch = (pred: (e: SQL) => SQL): SQL => {
    const lineHit = sql`EXISTS (SELECT 1 ${linesFrom} AND ${pred(def.line)})`;
    // COALESCE: a NULL header must count as "no match", or NOT(…) turns NULL.
    return def.header ? sql`(COALESCE(${pred(def.header)}, FALSE) OR ${lineHit})` : lineHit;
  };
  const posOf = (g: SfFilter) => (e: SQL) =>
    filterSql({ sql: e, type: def.type }, g, today) ?? sql`TRUE`;
  switch (f.kind) {
    case 'values': {
      if (def.type !== 'list' && def.type !== 'text')
        throw new ValidationError('A tick-list filter needs a text or list column.');
      const real = f.values.filter((v) => v !== SF_BLANK);
      const parts: SQL[] = [];
      if (real.length > 0) {
        const list = sql.join(
          real.map((v) => sql`${v}`),
          sql`, `,
        );
        parts.push(anyMatch((e) => sql`${e}::text IN (${list})`));
      }
      if (f.values.includes(SF_BLANK)) parts.push(sql`NOT ${anyMatch(nonBlank)}`);
      return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`FALSE`;
    }
    case 'text':
      return f.op === 'notContains'
        ? sql`NOT ${anyMatch(posOf({ ...f, op: 'contains' }))}`
        : anyMatch(posOf(f));
    case 'num':
      return f.op === 'ne' ? sql`NOT ${anyMatch(posOf({ ...f, op: 'eq' }))}` : anyMatch(posOf(f));
    case 'date':
      return anyMatch(posOf(f));
  }
}

/** Split `sf` into the document map's part and the lifted line predicates. */
export function liftLineFilters(
  sf: SfQuery | undefined,
  spec: SfLiftSpec,
  opts?: SfOptions,
): LiftedSf {
  if (!sf || sf.filters.length === 0) return { docSf: sf, lineFrag: sql``, lifted: false };
  const own = (field: string): SfLiftedField | undefined =>
    Object.prototype.hasOwnProperty.call(spec.fields, field) ? spec.fields[field] : undefined;
  const today = sfTodayIst();
  const parts: SQL[] = [];
  let lifted = false;
  for (const f of sf.filters) {
    const def = own(f.field);
    if (!def) continue;
    lifted = true;
    if (def.price && opts?.canSeePrice !== true) {
      throw new ValidationError(`You cannot sort or filter by "${f.field}".`);
    }
    const piece = liftedPredicate(def, f, spec.linesFrom, today);
    if (piece) parts.push(piece);
  }
  const docSf: SfQuery = { ...sf, filters: sf.filters.filter((f) => !own(f.field)) };
  return {
    docSf,
    lineFrag: parts.length > 0 ? sql`AND ${sql.join(parts, sql` AND `)}` : sql``,
    lifted,
  };
}

/** ADR-303 — the first line's value of a line fact, as a SCALAR subquery for
 *  the SELECT list / a sort: Postgres evaluates it only for the rows the page
 *  returns (or the sort needs), never for every document before the LIMIT.
 *  `key` picks which lines count (non-NULL); `order` is the line order. */
export function sfFirstLine(linesFrom: SQL, value: SQL, key: SQL, order: SQL): SQL {
  return sql`(SELECT ${value} ${linesFrom} AND ${key} IS NOT NULL ORDER BY ${order} LIMIT 1)`;
}

/** ADR-303 — how many MORE distinct values the lines carry ("SO-1 +2"). */
export function sfExtraDistinct(linesFrom: SQL, key: SQL): SQL {
  return sql`(SELECT GREATEST(COUNT(DISTINCT ${key}) - 1, 0)::int ${linesFrom})`;
}
