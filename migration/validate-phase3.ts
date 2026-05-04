// migration/validate-phase3.ts
//
// T-024d — Phase 3 sign-off validation.
//
// What this script verifies:
//   1. Field-level diff: for every transform row, the corresponding DB row
//      matches on every mapped column (jsonb compared as canonical JSON).
//   2. Orphan FK checks: every FK column points to an existing parent row.
//   3. Row counts match the transform output.
//   4. v_jc_op_status and v_jc_status views return non-zero results with
//      sensible computed_status values.
//
// Read-only. Output to migration/load-output/_phase3_validation.json.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase3.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase3

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { closeDb, rawSql } from './load/db';

interface TransformedFile<T> {
  table: string;
  rowCount: number;
  rows: T[];
}

interface BaseRow {
  _legacyId: string;
  id: string;
  [k: string]: unknown;
}

type DbRow = Record<string, unknown>;
type MappedRow = Record<string, unknown>;
type Mapper<T extends BaseRow> = (row: T) => MappedRow;

// ─── Mappers — mirror load.ts mappers but only the columns we want to verify.
// Audit + company_id columns are injected by the loader and verified by orphan
// checks below, so we don't include them in the field-level diff.

const ROUTE_CARD_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  item_id: row['itemId'],
  current_revision: row['currentRevision'],
  notes: row['notes'],
});

const ROUTE_CARD_OP_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  route_card_id: row['routeCardId'],
  op_seq: row['opSeq'],
  machine_id: row['machineId'],
  machine_code_text: row['machineCodeText'],
  operation: row['operation'],
  op_type: row['opType'],
  cycle_time_min: row['cycleTimeMin'],
  program: row['program'],
  tool_no: row['toolNo'],
  tool_details: row['toolDetails'],
  qc_required: row['qcRequired'],
});

const ROUTE_CARD_REVISION_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  route_card_id: row['routeCardId'],
  revision_no: row['revisionNo'],
  notes: row['notes'],
  ops_snapshot: row['opsSnapshot'],
});

const JOB_CARD_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  jc_date: row['jcDate'],
  item_id: row['itemId'],
  order_qty: row['orderQty'],
  priority: row['priority'],
  due_date: row['dueDate'],
  drawing_file_path: row['drawingFilePath'],
  source_legacy_ref: row['sourceLegacyRef'],
});

const JC_OP_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  job_card_id: row['jobCardId'],
  op_seq: row['opSeq'],
  machine_id: row['machineId'],
  machine_code_text: row['machineCodeText'],
  operation: row['operation'],
  op_type: row['opType'],
  cycle_time_min: row['cycleTimeMin'],
  program: row['program'],
  tool_no: row['toolNo'],
  tool_details: row['toolDetails'],
  qc_required: row['qcRequired'],
  qc_call_date: row['qcCallDate'],
  qc_attended_date: row['qcAttendedDate'],
  rework_qty: row['reworkQty'],
  outsource_vendor_id: row['outsourceVendorId'],
  outsource_vendor_text: row['outsourceVendorText'],
  outsource_cost: row['outsourceCost'],
  outsource_status: row['outsourceStatus'],
  outsource_dc_no: row['outsourceDcNo'],
  outsource_sent_qty: row['outsourceSentQty'],
  outsource_sent_date: row['outsourceSentDate'],
  outsource_returned_qty: row['outsourceReturnedQty'],
});

const OP_LOG_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  jc_op_id: row['jcOpId'],
  log_no: row['logNo'],
  log_type: row['logType'],
  log_date: row['logDate'],
  shift: row['shift'],
  qty: row['qty'],
  reject_qty: row['rejectQty'],
  operator_id: row['operatorId'],
  operator_name: row['operatorName'],
  start_time: row['startTime'],
  remarks: row['remarks'],
});

const RUNNING_OP_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  jc_op_id: row['jcOpId'],
  machine_id: row['machineId'],
  is_osp: row['isOsp'],
  operator_id: row['operatorId'],
  operator_name: row['operatorName'],
  start_date: row['startDate'],
  start_time: row['startTime'],
  shift: row['shift'],
  status: row['status'],
});

const TABLES = [
  'route_cards',
  'route_card_ops',
  'route_card_revisions',
  'job_cards',
  'jc_ops',
  'op_log',
  'running_ops',
] as const;
type TableName = (typeof TABLES)[number];

const MAPPERS: Record<TableName, Mapper<BaseRow>> = {
  route_cards: ROUTE_CARD_MAPPER,
  route_card_ops: ROUTE_CARD_OP_MAPPER,
  route_card_revisions: ROUTE_CARD_REVISION_MAPPER,
  job_cards: JOB_CARD_MAPPER,
  jc_ops: JC_OP_MAPPER,
  op_log: OP_LOG_MAPPER,
  running_ops: RUNNING_OP_MAPPER,
};

// op_log, route_card_revisions, running_ops don't have deleted_at.
const TABLES_WITHOUT_DELETED_AT = new Set<TableName>([
  'op_log',
  'route_card_revisions',
  'running_ops',
]);

// Columns whose value is jsonb on the DB side and a JS array/object on the
// transform side; compare via canonical JSON.
const JSONB_COLUMNS: Record<string, Set<string>> = {
  route_card_revisions: new Set(['ops_snapshot']),
};

// Postgres `time` columns return 'HH:MM:SS'; transform emits 'HH:MM' to match
// the legacy form. Pad to HH:MM:SS for comparison; both encode the same instant.
const TIME_COLUMNS: Record<string, Set<string>> = {
  op_log: new Set(['start_time']),
  running_ops: new Set(['start_time']),
};

function normaliseTime(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  if (/^\d{1,2}:\d{2}$/.test(v)) return `${v}:00`;
  return v;
}

interface FieldDiff {
  legacyId: string;
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

interface TableValidation {
  table: TableName;
  transformRowCount: number;
  dbCount: number;
  diff: number;
  countStatus: 'OK' | 'MISMATCH';
  matchedRows: number;
  missingFromDb: string[];
  fieldDiffs: FieldDiff[];
  diffStatus: 'OK' | 'MISMATCH';
}

interface OrphanCheck {
  table: TableName;
  column: string;
  parentTable: string;
  orphanCount: number;
  status: 'OK' | 'ORPHANS_FOUND';
}

interface ViewCheck {
  view: string;
  rowCount: number;
  statusBreakdown: Record<string, number>;
  status: 'OK' | 'EMPTY' | 'ERROR';
  notes: string[];
}

interface ValidationReport {
  generatedAt: string;
  companyId: string;
  tables: TableValidation[];
  orphanChecks: OrphanCheck[];
  views: ViewCheck[];
  overallStatus: 'PASS' | 'FAIL';
  summary: string;
}

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

function readTransform<T>(table: string, transformDir: string): TransformedFile<T> {
  const path = join(transformDir, `${table}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as TransformedFile<T>;
}

async function resolveCompanyId(): Promise<string> {
  const company = await rawSql<Array<{ id: string }>>`
    SELECT id FROM public.companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  const id = company[0]?.id;
  if (!id) throw new Error('No company in public.companies');
  return id;
}

function normalise(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

// Canonical JSON for jsonb deep compare. Keys sorted, undefined stripped.
function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(val).sort()) sorted[key] = (val as Record<string, unknown>)[key];
      return sorted;
    }
    return val;
  });
}

async function validateTable(
  table: TableName,
  transformDir: string,
  companyId: string,
): Promise<TableValidation> {
  const file = readTransform<BaseRow>(table, transformDir);
  const mapper = MAPPERS[table];
  const filterDeleted = !TABLES_WITHOUT_DELETED_AT.has(table);
  const jsonbCols = JSONB_COLUMNS[table] ?? new Set<string>();

  const dbRows = (filterDeleted
    ? await rawSql<DbRow[]>`
        SELECT * FROM ${rawSql(table)}
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      `
    : await rawSql<DbRow[]>`
        SELECT * FROM ${rawSql(table)}
        WHERE company_id = ${companyId}::uuid
      `) as unknown as DbRow[];

  const dbById = new Map<string, DbRow>();
  for (const r of dbRows) dbById.set(String(r['id']), r);

  const fieldDiffs: FieldDiff[] = [];
  const missing: string[] = [];
  let matched = 0;

  for (const transformRow of file.rows) {
    const expected = mapper(transformRow);
    const id = String(expected['id']);
    const dbRow = dbById.get(id);
    if (!dbRow) {
      missing.push(transformRow._legacyId);
      continue;
    }
    matched++;

    const timeCols = TIME_COLUMNS[table] ?? new Set<string>();
    for (const [col, expectedVal] of Object.entries(expected)) {
      if (col === 'id') continue;
      let actualVal = normalise(dbRow[col]);
      let expectedNorm = normalise(expectedVal);
      if (timeCols.has(col)) {
        actualVal = normaliseTime(actualVal);
        expectedNorm = normaliseTime(expectedNorm);
      }

      if (jsonbCols.has(col)) {
        if (canonicalJson(actualVal) !== canonicalJson(expectedNorm)) {
          fieldDiffs.push({
            legacyId: transformRow._legacyId,
            id,
            field: col,
            expected: expectedNorm,
            actual: actualVal,
          });
        }
      } else if (actualVal !== expectedNorm) {
        fieldDiffs.push({
          legacyId: transformRow._legacyId,
          id,
          field: col,
          expected: expectedNorm,
          actual: actualVal,
        });
      }
    }
  }

  const dbCount = dbRows.length;
  const diff = file.rowCount - dbCount;

  return {
    table,
    transformRowCount: file.rowCount,
    dbCount,
    diff,
    countStatus: diff === 0 ? 'OK' : 'MISMATCH',
    matchedRows: matched,
    missingFromDb: missing,
    fieldDiffs,
    diffStatus: missing.length === 0 && fieldDiffs.length === 0 ? 'OK' : 'MISMATCH',
  };
}

// FK columns to check, organised as (child_table, child_column, parent_table).
// Non-nullable FKs always checked; nullable ones only matter when the column
// is non-null — the SQL handles both via the IS NOT NULL guard.
const FK_CHECKS: Array<{ table: TableName; column: string; parentTable: string }> = [
  { table: 'route_cards', column: 'item_id', parentTable: 'items' },
  { table: 'route_cards', column: 'created_by', parentTable: 'users' },
  { table: 'route_cards', column: 'updated_by', parentTable: 'users' },
  { table: 'route_card_ops', column: 'route_card_id', parentTable: 'route_cards' },
  { table: 'route_card_ops', column: 'machine_id', parentTable: 'machines' },
  { table: 'route_card_ops', column: 'created_by', parentTable: 'users' },
  { table: 'route_card_ops', column: 'updated_by', parentTable: 'users' },
  { table: 'route_card_revisions', column: 'route_card_id', parentTable: 'route_cards' },
  { table: 'route_card_revisions', column: 'created_by', parentTable: 'users' },
  { table: 'job_cards', column: 'item_id', parentTable: 'items' },
  { table: 'job_cards', column: 'created_by', parentTable: 'users' },
  { table: 'job_cards', column: 'updated_by', parentTable: 'users' },
  { table: 'jc_ops', column: 'job_card_id', parentTable: 'job_cards' },
  { table: 'jc_ops', column: 'machine_id', parentTable: 'machines' },
  { table: 'jc_ops', column: 'outsource_vendor_id', parentTable: 'vendors' },
  { table: 'jc_ops', column: 'created_by', parentTable: 'users' },
  { table: 'jc_ops', column: 'updated_by', parentTable: 'users' },
  { table: 'op_log', column: 'jc_op_id', parentTable: 'jc_ops' },
  { table: 'op_log', column: 'operator_id', parentTable: 'operators' },
  { table: 'op_log', column: 'created_by', parentTable: 'users' },
  { table: 'running_ops', column: 'jc_op_id', parentTable: 'jc_ops' },
  { table: 'running_ops', column: 'machine_id', parentTable: 'machines' },
  { table: 'running_ops', column: 'operator_id', parentTable: 'operators' },
  { table: 'running_ops', column: 'created_by', parentTable: 'users' },
  { table: 'running_ops', column: 'updated_by', parentTable: 'users' },
];

async function checkOrphans(): Promise<OrphanCheck[]> {
  const checks: OrphanCheck[] = [];
  for (const c of FK_CHECKS) {
    const rows = await rawSql<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM ${rawSql(c.table)} child
      WHERE child.${rawSql(c.column)} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${rawSql(c.parentTable)} parent
          WHERE parent.id = child.${rawSql(c.column)}
        )
    `;
    const orphanCount = rows[0]?.count ?? 0;
    checks.push({
      ...c,
      orphanCount,
      status: orphanCount === 0 ? 'OK' : 'ORPHANS_FOUND',
    });
  }
  return checks;
}

async function checkViews(companyId: string): Promise<ViewCheck[]> {
  const out: ViewCheck[] = [];

  try {
    const opStatus = await rawSql<Array<{ computed_status: string; c: number }>>`
      SELECT computed_status, count(*)::int AS c
      FROM public.v_jc_op_status
      WHERE company_id = ${companyId}::uuid
      GROUP BY computed_status
    `;
    const breakdown: Record<string, number> = {};
    for (const r of opStatus) breakdown[r.computed_status] = r.c;
    const total = opStatus.reduce((s, r) => s + r.c, 0);
    out.push({
      view: 'v_jc_op_status',
      rowCount: total,
      statusBreakdown: breakdown,
      status: total > 0 ? 'OK' : 'EMPTY',
      notes: [],
    });
  } catch (e) {
    out.push({
      view: 'v_jc_op_status',
      rowCount: 0,
      statusBreakdown: {},
      status: 'ERROR',
      notes: [(e as Error).message],
    });
  }

  try {
    const jcStatus = await rawSql<Array<{ computed_status: string; c: number }>>`
      SELECT computed_status, count(*)::int AS c
      FROM public.v_jc_status
      WHERE company_id = ${companyId}::uuid
      GROUP BY computed_status
    `;
    const breakdown: Record<string, number> = {};
    for (const r of jcStatus) breakdown[r.computed_status] = r.c;
    const total = jcStatus.reduce((s, r) => s + r.c, 0);
    out.push({
      view: 'v_jc_status',
      rowCount: total,
      statusBreakdown: breakdown,
      status: total > 0 ? 'OK' : 'EMPTY',
      notes: [],
    });
  } catch (e) {
    out.push({
      view: 'v_jc_status',
      rowCount: 0,
      statusBreakdown: {},
      status: 'ERROR',
      notes: [(e as Error).message],
    });
  }

  return out;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..');
  const transformDir = join(repoRoot, 'migration', 'transform');
  const outDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(outDir, { recursive: true });

  log('info', 'phase3_validation_starting');

  const companyId = await resolveCompanyId();
  log('info', 'company_resolved', { companyId });

  const tableResults: TableValidation[] = [];
  for (const table of TABLES) {
    const r = await validateTable(table, transformDir, companyId);
    tableResults.push(r);
    log('info', 'table_validated', {
      table: r.table,
      transform: r.transformRowCount,
      db: r.dbCount,
      matched: r.matchedRows,
      fieldDiffs: r.fieldDiffs.length,
      missing: r.missingFromDb.length,
      countStatus: r.countStatus,
      diffStatus: r.diffStatus,
    });
  }

  const orphanChecks = await checkOrphans();
  for (const c of orphanChecks) {
    log('info', 'orphan_check', { ...c });
  }

  const views = await checkViews(companyId);
  for (const v of views) {
    log('info', 'view_check', { ...v });
  }

  const tableFails = tableResults.filter(
    (r) => r.diffStatus === 'MISMATCH' || r.countStatus === 'MISMATCH',
  );
  const orphanFails = orphanChecks.filter((c) => c.status === 'ORPHANS_FOUND');
  const viewFails = views.filter((v) => v.status !== 'OK');
  const overall: 'PASS' | 'FAIL' =
    tableFails.length === 0 && orphanFails.length === 0 && viewFails.length === 0 ? 'PASS' : 'FAIL';

  const summary =
    overall === 'PASS'
      ? `Phase 3 op-entry chain validated: 7/7 tables match transform; 0 orphan FKs across ${FK_CHECKS.length} checks; both views return non-zero rows`
      : `Phase 3 validation FAILED: ${tableFails.length} table mismatch(es), ${orphanFails.length} orphan FK group(s), ${viewFails.length} view check(s) failed`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: tableResults,
    orphanChecks,
    views,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase3_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase3_validation_complete', {
    overallStatus: overall,
    outPath,
    summary,
  });

  if (overall !== 'PASS') process.exitCode = 1;
}

main()
  .catch((e) => {
    log('error', 'fatal', { error: (e as Error).message, stack: (e as Error).stack });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
