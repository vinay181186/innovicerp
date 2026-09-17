// Global Search — the SQL builder. NO database imports here on purpose: it is
// a pure function from (kinds, company, term, limit) to drizzle `sql`
// fragments, so it can be rendered and inspected without a connection.
//
// Two statements per search, both over the SAME per-kind UNION ALL:
//   buildSearchSql → the page: one SELECT per allowed kind (or the one
//                    requested kind), shaped to the same 10 columns, ordered
//                    and LIMITed to limit + 1 so the caller can say "more".
//   buildCountSql  → the count strip: `kind, COUNT(*)` over every allowed
//                    kind with no ORDER / LIMIT and only the WHERE, so it
//                    never pays for the particulars.
// Company id, search patterns and the limit are bound parameters (drizzle
// `sql` template), never string-concatenated.

import { sql, type SQL } from 'drizzle-orm';
import { type KindLines, type KindMeta } from './kinds';
import { DOC_KINDS } from './kinds-docs';
import { REGISTER_KINDS } from './kinds-registers';
import type { GlobalSearchKind } from './schema';

export const KINDS: readonly KindMeta[] = [...DOC_KINDS, ...REGISTER_KINDS];

/** Escape the ILIKE metacharacters in a user's search term so "%" or "_" is a
 *  literal search, not a wildcard. Local copy of the items/sales-orders helper
 *  by convention (each module owns its own search behaviour). The queries
 *  below say `ESCAPE '\'` explicitly so the escaping is not dependent on the
 *  server default. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Number → plain text: "45", "12.5" (trailing decimal zeros dropped), NULL stays NULL. */
const numText = (e: SQL): SQL =>
  sql`CASE WHEN ${e}::text LIKE '%.%' THEN rtrim(rtrim(${e}::text, '0'), '.') ELSE ${e}::text END`;

const or = (parts: SQL[]): SQL => sql.join(parts, sql` OR `);

interface Patterns {
  any: string;
  prefix: string;
}

/** `WHERE l.<fk> = t.id AND l.deleted_at IS NULL` for the line table. */
const lineScope = (ln: KindLines): SQL => sql`${ln.fk} = t.id AND l.deleted_at IS NULL`;

/** The WHERE clause: tenant + soft delete + "anything matches the term". */
function whereSql(m: KindMeta, companyId: string, p: Patterns): SQL {
  const like = (e: SQL): SQL => sql`${e} ILIKE ${p.any} ESCAPE '\\'`;
  const matchers: SQL[] = [like(m.docNo)];
  if (m.party) matchers.push(like(m.party));
  for (const e of m.text) matchers.push(like(e));
  for (const e of m.shown ?? []) matchers.push(like(e));
  for (const r of m.refs ?? []) matchers.push(like(r.expr));
  if (m.status) matchers.push(like(m.status));
  if (m.lines) {
    matchers.push(
      sql`EXISTS (SELECT 1 FROM ${m.lines.from}
        WHERE ${lineScope(m.lines)} AND (${or(m.lines.match.map(like))}))`,
    );
  }
  return sql`t.company_id = ${companyId}::uuid AND t.deleted_at IS NULL AND (${or(matchers)})`;
}

/** jsonb array of the linked-doc refs and header-level particulars, nulls dropped, order kept. */
function headLinesSql(m: KindMeta): SQL {
  const entries: SQL[] = [
    ...(m.refs ?? []).map((r) =>
      typeof r.label === 'string'
        ? sql`CASE WHEN NULLIF(${r.expr}::text, '') IS NOT NULL THEN ${r.label}::text || ' ' || ${r.expr}::text END`
        : sql`CASE WHEN NULLIF(${r.expr}::text, '') IS NOT NULL THEN concat_ws(' ', ${r.label}, ${r.expr}::text) END`,
    ),
    ...(m.flatLines ?? []),
  ];
  const arr =
    entries.length === 0
      ? sql`'[]'::jsonb`
      : sql`(SELECT COALESCE(jsonb_agg(hl.x ORDER BY hl.o), '[]'::jsonb)
          FROM unnest(ARRAY[${sql.join(entries, sql`, `)}]::text[]) WITH ORDINALITY AS hl(x, o)
          WHERE hl.x IS NOT NULL)`;
  return m.refsJson ? sql`COALESCE(${m.refsJson}, '[]'::jsonb) || ${arr}` : arr;
}

/** LEFT JOIN LATERAL over the line table: first 3 lines (+ "+N more") and the qty SUM,
 *  in ONE scan of the document's lines. Evaluated only for header rows that passed WHERE. */
function linesLateralSql(ln: KindLines): SQL {
  const total = ln.qty ? sql`sum(${ln.qty}) OVER ()` : sql`NULL::numeric`;
  return sql`LEFT JOIN LATERAL (
    SELECT jsonb_agg(CASE WHEN s.rn <= 3 THEN s.txt ELSE '+' || (s.cnt - 3)::text || ' more' END ORDER BY s.rn)
             FILTER (WHERE s.rn <= 4 AND (s.rn > 3 OR s.txt IS NOT NULL)) AS lines_json,
           max(s.total) AS line_qty
    FROM (SELECT ${ln.display} AS txt,
                 row_number() OVER (ORDER BY ${ln.order}) AS rn,
                 count(*) OVER () AS cnt,
                 ${total} AS total
          FROM ${ln.from} WHERE ${lineScope(ln)}) s
  ) ln ON true`;
}

/** `hit`: the first NOT-displayed text that matched — NULL when the doc no, party, a ref or
 *  a shown header line matched; else the first matching hidden header text field; else the
 *  matching column of the first matching line that is NOT one of the 3 displayed lines
 *  (a displayed line whose display text matched counts as "already visible" → NULL). */
function hitSql(m: KindMeta, p: Patterns): SQL {
  const like = (e: SQL): SQL => sql`${e} ILIKE ${p.any} ESCAPE '\\'`;
  const visible: SQL[] = [m.docNo, ...(m.party ? [m.party] : []), ...(m.shown ?? [])];
  for (const r of m.refs ?? []) visible.push(r.expr);
  const arms: SQL[] = visible.map((e) => sql`WHEN ${like(e)} THEN NULL`);
  for (const e of m.text) arms.push(sql`WHEN ${like(e)} THEN ${e}::text`);
  let fallback: SQL = sql`NULL::text`;
  if (m.lines) {
    const ln = m.lines;
    const lineArms = ln.match.map((c) => sql`WHEN ${like(c)} THEN ${c}::text`);
    fallback = sql`(SELECT CASE WHEN s.rn <= 3 AND ${like(sql`s.txt`)} THEN NULL ELSE s.hit END
      FROM (SELECT ${ln.display} AS txt,
                   row_number() OVER (ORDER BY ${ln.order}) AS rn,
                   CASE ${sql.join(lineArms, sql` `)} END AS hit
            FROM ${ln.from} WHERE ${lineScope(ln)}) s
      WHERE s.hit IS NOT NULL
      ORDER BY (s.rn <= 3 AND ${like(sql`s.txt`)}), s.rn
      LIMIT 1)`;
  }
  return sql`CASE ${sql.join(arms, sql` `)} ELSE ${fallback} END`;
}

// One SELECT per kind, all shaped to the same 10 columns so they UNION cleanly.
// `match_rank` is 0 when the doc no. starts with the term (exact-code hits
// float to the top), 1 otherwise.
function rowBranchSql(m: KindMeta, companyId: string, p: Patterns): SQL {
  const date = m.date ? sql`to_char(${m.date}, 'YYYY-MM-DD')` : sql`NULL::text`;
  const lines = m.lines
    ? sql`${headLinesSql(m)} || COALESCE(ln.lines_json, '[]'::jsonb)`
    : headLinesSql(m);
  const qty = m.lines?.qty ? numText(sql`ln.line_qty`) : m.qty ? numText(m.qty) : sql`NULL::text`;
  return sql`SELECT ${m.kind}::text AS kind,
      t.id::text AS id,
      ${m.docNo}::text AS doc_no,
      ${date} AS doc_date,
      ${m.party ?? sql`NULL::text`} AS party,
      ${lines} AS lines,
      ${qty} AS qty,
      ${m.status ?? sql`NULL::text`} AS status,
      ${hitSql(m, p)} AS hit,
      CASE WHEN ${m.docNo} ILIKE ${p.prefix} ESCAPE '\\' THEN 0 ELSE 1 END AS match_rank
    FROM ${m.from} ${m.lines ? linesLateralSql(m.lines) : sql``}
    WHERE ${whereSql(m, companyId, p)}`;
}

function countBranchSql(m: KindMeta, companyId: string, p: Patterns): SQL {
  return sql`SELECT ${m.kind}::text AS kind FROM ${m.from} WHERE ${whereSql(m, companyId, p)}`;
}

function patterns(q: string): Patterns {
  const escaped = escapeLikeTerm(q);
  return { any: `%${escaped}%`, prefix: `${escaped}%` };
}

function pick(kinds: readonly GlobalSearchKind[]): KindMeta[] {
  const allowed = new Set<GlobalSearchKind>(kinds);
  return KINDS.filter((m) => allowed.has(m.kind));
}

/** The page: rows for the given (already permission-filtered, possibly single) kinds.
 *  Asks for `limit + 1` rows so the caller can say "there is more" without a
 *  second COUNT over the union. Caller guarantees `kinds` is non-empty. */
export function buildSearchSql(
  kinds: readonly GlobalSearchKind[],
  companyId: string,
  q: string,
  limit: number,
): SQL {
  const p = patterns(q);
  const branches = pick(kinds).map((m) => rowBranchSql(m, companyId, p));
  const limitPlusOne = limit + 1;
  return sql`
    SELECT u.kind, u.id, u.doc_no, u.doc_date, u.party, u.lines, u.qty, u.status, u.hit
    FROM (${sql.join(branches, sql` UNION ALL `)}) u
    ORDER BY u.match_rank ASC, u.doc_date DESC NULLS LAST, u.doc_no DESC
    LIMIT ${limitPlusOne}
  `;
}

/** The count strip: matches per kind over EVERY allowed kind (no ORDER / LIMIT). */
export function buildCountSql(
  kinds: readonly GlobalSearchKind[],
  companyId: string,
  q: string,
): SQL {
  const p = patterns(q);
  const branches = pick(kinds).map((m) => countBranchSql(m, companyId, p));
  return sql`
    SELECT u.kind, COUNT(*)::int AS n
    FROM (${sql.join(branches, sql` UNION ALL `)}) u
    GROUP BY u.kind
  `;
}
