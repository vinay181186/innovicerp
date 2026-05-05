// Ad-hoc spec → SQL translator for the report builder (T-041b).
//
// Security model: column / filter / sort / group keys are whitelisted
// against the source's descriptor before any SQL is built. Filter values
// are bound via Drizzle's parameterised sql template, never interpolated.
// Identifiers are wrapped via sql.identifier().
//
// Layout:
//   buildRunSQL  → SELECT <selected_cols> FROM (<base>) base
//                  WHERE <filter_predicates>
//                  ORDER BY <sort_clauses>
//                  LIMIT 5000
//
//   buildSummarySQL (if spec.groupBy is set) →
//     SELECT <group> AS group, COUNT(*) AS count, <agg(sumCol)> AS aggregate
//     FROM (<base>) base
//     WHERE <filter_predicates>
//     GROUP BY <group>
//     ORDER BY <group>
//     LIMIT 200

import type {
  AdHocColumn,
  AdHocFilter,
  AdHocRow,
  AdHocSort,
  AdHocSpec,
  AdHocSummaryRow,
  AggFunction,
  FilterOp,
  SourceFieldDescriptor,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { getSource, type RegisteredSource } from './sources';

const ROW_LIMIT = 5000;
const SUMMARY_LIMIT = 200;

const TEXT_OPS: FilterOp[] = ['equals', 'notEquals', 'contains'];
const NUMBER_OPS: FilterOp[] = ['equals', 'notEquals', 'gt', 'lt'];
const DATE_OPS: FilterOp[] = ['equals', 'after', 'before'];

function fieldMap(source: RegisteredSource): Map<string, SourceFieldDescriptor> {
  return new Map(source.descriptor.fields.map((f) => [f.key, f]));
}

function assertOpAllowed(field: SourceFieldDescriptor, op: FilterOp): void {
  const allowed =
    field.type === 'text'
      ? TEXT_OPS
      : field.type === 'number'
        ? NUMBER_OPS
        : /* date | datetime */ DATE_OPS;
  if (!allowed.includes(op)) {
    throw new ValidationError(
      `Filter op "${op}" not supported on ${field.type} field "${field.key}"`,
    );
  }
}

function assertSpec(spec: AdHocSpec, source: RegisteredSource): void {
  const fields = fieldMap(source);
  if (spec.columns.length === 0) {
    throw new ValidationError('Spec must include at least one column');
  }
  const seen = new Set<string>();
  for (const key of spec.columns) {
    if (!fields.has(key)) {
      throw new ValidationError(`Unknown column "${key}" for source "${spec.sourceKey}"`);
    }
    if (seen.has(key)) {
      throw new ValidationError(`Duplicate column "${key}" in spec`);
    }
    seen.add(key);
  }

  for (const filter of spec.filters) {
    const f = fields.get(filter.field);
    if (!f) {
      throw new ValidationError(
        `Unknown filter field "${filter.field}" for source "${spec.sourceKey}"`,
      );
    }
    if (!f.filterable) {
      throw new ValidationError(`Field "${filter.field}" is not filterable`);
    }
    assertOpAllowed(f, filter.op);
  }

  for (const sort of spec.sort) {
    if (!fields.has(sort.field)) {
      throw new ValidationError(
        `Unknown sort field "${sort.field}" for source "${spec.sourceKey}"`,
      );
    }
  }

  if (spec.groupBy) {
    const f = fields.get(spec.groupBy);
    if (!f) {
      throw new ValidationError(
        `Unknown groupBy field "${spec.groupBy}" for source "${spec.sourceKey}"`,
      );
    }
    if (!f.groupable) {
      throw new ValidationError(`Field "${spec.groupBy}" is not groupable`);
    }
  }

  if (spec.sumCol) {
    const f = fields.get(spec.sumCol);
    if (!f) {
      throw new ValidationError(
        `Unknown sumCol field "${spec.sumCol}" for source "${spec.sourceKey}"`,
      );
    }
    if (f.type !== 'number' && spec.sumFn !== 'COUNT') {
      throw new ValidationError(
        `sumFn "${spec.sumFn}" requires a number sumCol; "${spec.sumCol}" is ${f.type}`,
      );
    }
  }
}

// ─── Predicate / sort builders ───────────────────────────────────────────

function filterPredicate(filter: AdHocFilter, field: SourceFieldDescriptor): SQL | null {
  if (filter.value.trim() === '') return null;
  const ident = sql.identifier(filter.field);
  const v = filter.value;

  switch (filter.op) {
    case 'equals':
      if (field.type === 'number') {
        return sql`${ident} = ${v}::numeric`;
      }
      if (field.type === 'date' || field.type === 'datetime') {
        return sql`${ident}::date = ${v}::date`;
      }
      return sql`lower(${ident}::text) = lower(${v})`;
    case 'notEquals':
      if (field.type === 'number') {
        return sql`${ident} <> ${v}::numeric`;
      }
      return sql`lower(${ident}::text) <> lower(${v})`;
    case 'contains':
      return sql`${ident}::text ILIKE ${'%' + v + '%'}`;
    case 'gt':
      return sql`${ident} > ${v}::numeric`;
    case 'lt':
      return sql`${ident} < ${v}::numeric`;
    case 'after':
      return sql`${ident}::date > ${v}::date`;
    case 'before':
      return sql`${ident}::date < ${v}::date`;
  }
}

function sortClause(sort: AdHocSort): SQL {
  const ident = sql.identifier(sort.field);
  return sort.dir === 'desc' ? sql`${ident} DESC NULLS LAST` : sql`${ident} ASC NULLS LAST`;
}

function aggregateExpr(fn: AggFunction, sumCol: string | null): SQL {
  if (!sumCol || fn === 'COUNT') return sql`COUNT(*)::numeric`;
  const ident = sql.identifier(sumCol);
  switch (fn) {
    case 'SUM':
      return sql`COALESCE(SUM(${ident}), 0)::numeric`;
    case 'AVG':
      return sql`COALESCE(AVG(${ident}), 0)::numeric`;
    case 'MIN':
      return sql`MIN(${ident})::numeric`;
    case 'MAX':
      return sql`MAX(${ident})::numeric`;
  }
}

function joinFragments(parts: SQL[], sep: SQL): SQL {
  if (parts.length === 0) return sql``;
  let acc = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    acc = sql`${acc}${sep}${parts[i]!}`;
  }
  return acc;
}

// ─── Public runner ───────────────────────────────────────────────────────

export interface RunAdHocContext {
  tx: DbTransaction;
  companyId: string;
}

export interface RunAdHocResult {
  columns: AdHocColumn[];
  rows: AdHocRow[];
  summary: AdHocSummaryRow[];
  summaryFunction: AggFunction | null;
  summaryColumn: string | null;
}

export async function runAdHoc(spec: AdHocSpec, ctx: RunAdHocContext): Promise<RunAdHocResult> {
  const source = getSource(spec.sourceKey);
  if (!source) {
    throw new ValidationError(`Unknown source "${spec.sourceKey}"`);
  }
  assertSpec(spec, source);

  const fields = fieldMap(source);
  const base = source.baseSelect({ companyId: ctx.companyId });

  const colIdents = spec.columns.map((k) => sql`${sql.identifier(k)}`);
  const selectList = joinFragments(colIdents, sql`, `);

  const predicates: SQL[] = [];
  for (const filter of spec.filters) {
    const f = fields.get(filter.field)!;
    const pred = filterPredicate(filter, f);
    if (pred) predicates.push(pred);
  }
  const where = predicates.length ? sql`WHERE ${joinFragments(predicates, sql` AND `)}` : sql``;

  const sortClauses =
    spec.sort.length > 0
      ? sql`ORDER BY ${joinFragments(
          spec.sort.map((s) => sortClause(s)),
          sql`, `,
        )}`
      : sql``;

  const runQuery = sql`
    SELECT ${selectList}
    FROM (${base}) AS base
    ${where}
    ${sortClauses}
    LIMIT ${ROW_LIMIT}
  `;

  const result = await ctx.tx.execute(runQuery);
  const rawRows = result as unknown as Array<Record<string, unknown>>;
  const rows: AdHocRow[] = rawRows.map((r) => coerceRow(r, spec.columns, fields));

  const columns: AdHocColumn[] = spec.columns.map((k) => {
    const f = fields.get(k)!;
    return { key: k, label: f.label, type: f.type };
  });

  let summary: AdHocSummaryRow[] = [];
  let summaryFunction: AggFunction | null = null;
  let summaryColumn: string | null = null;
  if (spec.groupBy) {
    const groupIdent = sql.identifier(spec.groupBy);
    const aggExpr = aggregateExpr(spec.sumFn, spec.sumCol);

    const summaryQuery = sql`
      SELECT
        ${groupIdent}::text AS group,
        COUNT(*)::int       AS count,
        ${aggExpr}          AS aggregate
      FROM (${base}) AS base
      ${where}
      GROUP BY ${groupIdent}
      ORDER BY ${groupIdent} ASC NULLS LAST
      LIMIT ${SUMMARY_LIMIT}
    `;

    const sumResult = await ctx.tx.execute(summaryQuery);
    const sumRaw = sumResult as unknown as Array<Record<string, unknown>>;
    summary = sumRaw.map((r) => ({
      group: (r['group'] as string | null) ?? '—',
      count: Number(r['count'] ?? 0),
      aggregate: r['aggregate'] != null ? String(r['aggregate']) : null,
    }));
    summaryFunction = spec.sumFn;
    summaryColumn = spec.sumCol;
  }

  return { columns, rows, summary, summaryFunction, summaryColumn };
}

function coerceRow(
  raw: Record<string, unknown>,
  columns: string[],
  fields: Map<string, SourceFieldDescriptor>,
): AdHocRow {
  const out: AdHocRow = {};
  for (const k of columns) {
    const f = fields.get(k)!;
    const v = raw[k];
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    if (f.type === 'number') {
      out[k] = typeof v === 'number' ? v : Number(v);
      continue;
    }
    if (f.type === 'date') {
      out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
      continue;
    }
    if (f.type === 'datetime') {
      out[k] = v instanceof Date ? v.toISOString() : String(v);
      continue;
    }
    out[k] = String(v);
  }
  return out;
}
