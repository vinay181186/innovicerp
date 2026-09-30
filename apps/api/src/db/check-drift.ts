/* eslint-disable no-console -- CLI script: its console output IS the report (same as apply-sql / seed). */
// READ-ONLY drift check (finding S7): compares the Drizzle definitions in
// schema.ts with the live database — tables, columns, SQL types, NOT NULL,
// column defaults, and enum labels. Prints every mismatch; exits 1 when there
// is any, 0 when schema.ts and the database agree.
//
// Usage (DB_TARGET is REQUIRED, same guard as apply-sql — see db-target.ts):
//   DB_TARGET=TEST pnpm --filter @innovic/api db:drift --env-file <test.env>
//   (or: DB_TARGET=TEST pnpm --filter @innovic/api exec dotenv -e <test.env> -- tsx src/db/check-drift.ts)
// Only DATABASE_URL is read from the env file.
//
// Safety: every query runs inside BEGIN READ ONLY and the transaction is rolled
// back; the script never writes.
//
// Not a mismatch (listed under "info" only): tables / enums that exist in the
// database but are not declared in schema.ts (SQL-only objects such as
// schema_migrations). CHECK constraints and indexes are not compared.

import { SQL, StringChunk, is } from 'drizzle-orm';
import { PgTable, getTableConfig, isPgEnum, type PgColumn } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { resolveDbTarget } from './db-target';
import * as schema from './schema';

const { target, url } = resolveDbTarget('check-drift', process.argv.slice(2), {
  allowEnvFile: true,
});

interface DbCol {
  table_schema: string;
  table_name: string;
  column_name: string;
  sql_type: string;
  not_null: boolean;
  column_default: string | null;
  is_identity: boolean;
}

/** Drizzle's SQL type spelled the way Postgres format_type() prints it. */
function normType(t: string): string {
  let s = t
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ');
  s = s.replace(/"/g, '');
  const arr = s.endsWith('[]') ? '[]' : '';
  if (arr) s = s.slice(0, -2);
  const map: Record<string, string> = {
    serial: 'integer',
    serial4: 'integer',
    int: 'integer',
    int4: 'integer',
    bigserial: 'bigint',
    int8: 'bigint',
    smallserial: 'smallint',
    int2: 'smallint',
    float8: 'double precision',
    float4: 'real',
    bool: 'boolean',
    timestamptz: 'timestamp with time zone',
    timestamp: 'timestamp without time zone',
    time: 'time without time zone',
    timetz: 'time with time zone',
  };
  if (map[s]) s = map[s]!;
  s = s.replace(/^varchar/, 'character varying').replace(/^char\b/, 'character');
  s = s.replace(/^timestamp(\(\d+\))? with time zone$/, 'timestamp$1 with time zone');
  s = s.replace(/^timestamp(\(\d+\))?$/, 'timestamp$1 without time zone');
  s = s.replace(/^public\./, '');
  return s + arr;
}

/** A default value reduced to a comparable string (casts, quotes, parens removed). */
function normDefault(d: string): string {
  let s = d.trim();
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(/::[a-z_ ."]+(\(\d+(,\s*\d+)?\))?(\[\])?$/i, '').trim();
    if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
    if (s === before) break;
  }
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).replace(/''/g, "'");
  s = s.toLowerCase().replace(/\s+/g, '');
  if (s === 'current_timestamp') s = 'now()';
  return s;
}

function drizzleDefault(col: PgColumn): string | undefined {
  const d: unknown = col.default;
  if (d === undefined) return undefined;
  if (is(d, SQL)) {
    return (d as SQL).queryChunks
      .map((c) => (is(c, StringChunk) ? (c as StringChunk).value.join('') : String(c)))
      .join('');
  }
  if (d === null) return 'null';
  if (typeof d === 'object') return JSON.stringify(d);
  return String(d as string | number | boolean);
}

const mismatches: string[] = [];
const info: string[] = [];

// ---- schema.ts side --------------------------------------------------------
const tables = new Map<string, { name: string; cols: PgColumn[] }>();
const enums = new Map<string, string[]>();
for (const value of Object.values(schema)) {
  if (is(value, PgTable)) {
    const cfg = getTableConfig(value);
    tables.set(`${cfg.schema ?? 'public'}.${cfg.name}`, { name: cfg.name, cols: cfg.columns });
  } else if (isPgEnum(value)) {
    enums.set(value.enumName, [...value.enumValues]);
  }
}

// ---- database side (read only) ---------------------------------------------
const sql = postgres(url, { prepare: false, max: 1 });
let dbCols: DbCol[] = [];
let dbEnums: { name: string; labels: string[] }[] = [];
try {
  await sql.unsafe('BEGIN READ ONLY');
  dbCols = await sql.unsafe<DbCol[]>(`
    SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name,
           format_type(a.atttypid, a.atttypmod) AS sql_type, a.attnotnull AS not_null,
           pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
           (a.attidentity <> '') AS is_identity
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid AND c.relkind IN ('r', 'p')
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1, 2, a.attnum`);
  dbEnums = await sql.unsafe<{ name: string; labels: string[] }[]>(`
    SELECT t.typname AS name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     GROUP BY t.typname`);
} finally {
  await sql.unsafe('ROLLBACK').catch(() => undefined);
  await sql.end();
}

const dbTables = new Map<string, Map<string, DbCol>>();
for (const r of dbCols) {
  const key = `${r.table_schema}.${r.table_name}`;
  if (!dbTables.has(key)) dbTables.set(key, new Map());
  dbTables.get(key)!.set(r.column_name, r);
}

// ---- compare tables / columns ---------------------------------------------
for (const [key, t] of [...tables.entries()].sort()) {
  const live = dbTables.get(key);
  if (!live) {
    mismatches.push(`${t.name}: declared in schema.ts, TABLE MISSING in ${target} DB`);
    continue;
  }
  const declared = new Set<string>();
  for (const col of t.cols) {
    declared.add(col.name);
    const d = live.get(col.name);
    const where = `${t.name}.${col.name}`;
    if (!d) {
      mismatches.push(`${where}: in schema.ts, COLUMN MISSING in ${target} DB`);
      continue;
    }
    const sType = normType(col.getSQLType());
    const dType = normType(d.sql_type);
    if (sType !== dType) mismatches.push(`${where}: type schema.ts=${sType} vs DB=${dType}`);
    if (col.notNull !== d.not_null) {
      mismatches.push(
        `${where}: NOT NULL schema.ts=${String(col.notNull)} vs DB=${String(d.not_null)}`,
      );
    }
    const isSerial = /serial/i.test(col.getSQLType());
    const sDef = isSerial ? '<serial>' : drizzleDefault(col);
    const dDef = d.is_identity
      ? '<identity>'
      : d.column_default?.startsWith('nextval(')
        ? '<serial>'
        : (d.column_default ?? undefined);
    if (sDef === undefined && dDef !== undefined) {
      mismatches.push(`${where}: default schema.ts=none vs DB=${dDef}`);
    } else if (sDef !== undefined && dDef === undefined) {
      mismatches.push(`${where}: default schema.ts=${sDef} vs DB=none`);
    } else if (
      sDef !== undefined &&
      dDef !== undefined &&
      normDefault(sDef) !== normDefault(dDef)
    ) {
      mismatches.push(`${where}: default schema.ts=${sDef} vs DB=${dDef}`);
    }
  }
  for (const [name, d] of live) {
    if (!declared.has(name)) {
      mismatches.push(
        `${t.name}.${name}: in ${target} DB (${d.sql_type}, notNull=${String(d.not_null)}), NOT in schema.ts`,
      );
    }
  }
}
for (const key of [...dbTables.keys()].sort()) {
  if (!tables.has(key)) info.push(`table ${key}: in ${target} DB only (not declared in schema.ts)`);
}

// ---- compare enums -----------------------------------------------------------
const liveEnums = new Map(dbEnums.map((e) => [e.name, e.labels]));
for (const [name, values] of [...enums.entries()].sort()) {
  const live = liveEnums.get(name);
  if (!live) {
    mismatches.push(`enum ${name}: in schema.ts, MISSING in ${target} DB`);
    continue;
  }
  const missing = values.filter((v) => !live.includes(v));
  const extra = live.filter((v) => !values.includes(v));
  if (missing.length) mismatches.push(`enum ${name}: labels missing in DB: ${missing.join(', ')}`);
  if (extra.length)
    mismatches.push(`enum ${name}: DB labels not in schema.ts: ${extra.join(', ')}`);
}
for (const name of [...liveEnums.keys()].sort()) {
  if (!enums.has(name)) info.push(`enum ${name}: in ${target} DB only (not declared in schema.ts)`);
}

// ---- report ------------------------------------------------------------------
console.log(`\n[check-drift] ${target}: ${tables.size} tables / ${enums.size} enums in schema.ts`);
console.log(`[check-drift] ${mismatches.length} mismatch(es)`);
for (const m of mismatches) console.log(`  MISMATCH  ${m}`);
if (info.length) {
  console.log(`[check-drift] ${info.length} info line(s) (not failures)`);
  for (const m of info) console.log(`  info      ${m}`);
}
process.exitCode = mismatches.length > 0 ? 1 : 0;
