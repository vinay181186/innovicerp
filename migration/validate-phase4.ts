// migration/validate-phase4.ts
//
// T-029d — Phase 4 sign-off validation.
//
// What this script verifies:
//   1. Field-level diff: for every transform row across the 4 new tables, the
//      corresponding DB row matches on every mapped column.
//   2. Orphan FK checks: every FK column points to an existing parent row,
//      including the 2 new FKs on `job_cards` (source_so_line_id /
//      source_jw_line_id).
//   3. Row counts match the transform output (2 + 9 + 2 + 2 = 15).
//   4. JC source FK backfill verification: every JC with a non-null
//      `source_legacy_ref` whose payload's `soRefId` (or `jwRefId`) resolves
//      against the transform's _id_map has the matching FK column populated.
//      JCs whose legacy refId doesn't resolve are recorded but don't fail the
//      run (legacy data divergence is captured for the audit trail).
//
// Read-only. Output to migration/load-output/_phase4_validation.json.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase4.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase4

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

// ─── Mappers — mirror load.ts mappers; cover only the columns we want to
// verify. company_id + audit columns are injected by the loader and verified
// by orphan checks below.

const SALES_ORDER_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  so_date: row['soDate'],
  client_id: row['clientId'],
  customer_name: row['customerName'],
  client_po_no: row['clientPoNo'],
  type: row['type'],
  status: row['status'],
  gst_percent: row['gstPercent'],
  bom_master_id: row['bomMasterId'],
  bom_status: row['bomStatus'],
  cost_center: row['costCenter'],
  remarks: row['remarks'],
});

const SALES_ORDER_LINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  sales_order_id: row['salesOrderId'],
  line_no: row['lineNo'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  part_name: row['partName'],
  material: row['material'],
  drawing_no: row['drawingNo'],
  uom: row['uom'],
  order_qty: row['orderQty'],
  rate: row['rate'],
  due_date: row['dueDate'],
  client_po_line_no: row['clientPoLineNo'],
  status: row['status'],
});

const JOB_WORK_ORDER_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  jw_date: row['jwDate'],
  client_id: row['clientId'],
  customer_name: row['customerName'],
  client_po_no: row['clientPoNo'],
  status: row['status'],
  remarks: row['remarks'],
});

const JOB_WORK_ORDER_LINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  job_work_order_id: row['jobWorkOrderId'],
  line_no: row['lineNo'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  part_name: row['partName'],
  material: row['material'],
  drawing_no: row['drawingNo'],
  uom: row['uom'],
  order_qty: row['orderQty'],
  due_date: row['dueDate'],
  client_material: row['clientMaterial'],
  client_material_qty: row['clientMaterialQty'],
  material_received_date: row['materialReceivedDate'],
  material_received_qty: row['materialReceivedQty'],
  status: row['status'],
});

const TABLES = [
  'sales_orders',
  'sales_order_lines',
  'job_work_orders',
  'job_work_order_lines',
] as const;
type TableName = (typeof TABLES)[number];

const MAPPERS: Record<TableName, Mapper<BaseRow>> = {
  sales_orders: SALES_ORDER_MAPPER,
  sales_order_lines: SALES_ORDER_LINE_MAPPER,
  job_work_orders: JOB_WORK_ORDER_MAPPER,
  job_work_order_lines: JOB_WORK_ORDER_LINE_MAPPER,
};

// All Phase 4 tables have deleted_at; nothing to special-case here.

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
  table: string;
  column: string;
  parentTable: string;
  orphanCount: number;
  status: 'OK' | 'ORPHANS_FOUND';
}

type BackfillJcStatus =
  | 'verified_so'
  | 'verified_jw'
  | 'fk_missing'
  | 'fk_mismatch'
  | 'legacy_ref_unresolved'
  | 'no_legacy_ref'
  | 'json_parse_failed'
  | 'no_so_or_jw_ref_in_payload';

interface BackfillJcRow {
  jcId: string;
  jcCode: string;
  status: BackfillJcStatus;
  expectedColumn?: 'source_so_line_id' | 'source_jw_line_id';
  expectedTarget?: string;
  actualSo?: string | null;
  actualJw?: string | null;
  legacyTargetId?: string;
}

interface BackfillCheck {
  jcsExamined: number;
  verified: number;
  fkIssues: BackfillJcRow[];
  legacyUnresolved: BackfillJcRow[];
  rows: BackfillJcRow[];
  status: 'OK' | 'FK_ISSUES_FOUND';
}

interface ValidationReport {
  generatedAt: string;
  companyId: string;
  tables: TableValidation[];
  orphanChecks: OrphanCheck[];
  backfill: BackfillCheck;
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

async function validateTable(
  table: TableName,
  transformDir: string,
  companyId: string,
): Promise<TableValidation> {
  const file = readTransform<BaseRow>(table, transformDir);
  const mapper = MAPPERS[table];

  const dbRows = (await rawSql<DbRow[]>`
    SELECT * FROM ${rawSql(table)}
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
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

    for (const [col, expectedVal] of Object.entries(expected)) {
      if (col === 'id') continue;
      const actualVal = normalise(dbRow[col]);
      const expectedNorm = normalise(expectedVal);

      if (actualVal !== expectedNorm) {
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
// Includes the 2 new FKs on `job_cards` from ADR-012 #2.
const FK_CHECKS: Array<{ table: string; column: string; parentTable: string }> = [
  { table: 'sales_orders', column: 'client_id', parentTable: 'clients' },
  { table: 'sales_orders', column: 'created_by', parentTable: 'users' },
  { table: 'sales_orders', column: 'updated_by', parentTable: 'users' },
  { table: 'sales_order_lines', column: 'sales_order_id', parentTable: 'sales_orders' },
  { table: 'sales_order_lines', column: 'item_id', parentTable: 'items' },
  { table: 'sales_order_lines', column: 'created_by', parentTable: 'users' },
  { table: 'sales_order_lines', column: 'updated_by', parentTable: 'users' },
  { table: 'job_work_orders', column: 'client_id', parentTable: 'clients' },
  { table: 'job_work_orders', column: 'created_by', parentTable: 'users' },
  { table: 'job_work_orders', column: 'updated_by', parentTable: 'users' },
  {
    table: 'job_work_order_lines',
    column: 'job_work_order_id',
    parentTable: 'job_work_orders',
  },
  { table: 'job_work_order_lines', column: 'item_id', parentTable: 'items' },
  { table: 'job_work_order_lines', column: 'created_by', parentTable: 'users' },
  { table: 'job_work_order_lines', column: 'updated_by', parentTable: 'users' },
  { table: 'job_cards', column: 'source_so_line_id', parentTable: 'sales_order_lines' },
  { table: 'job_cards', column: 'source_jw_line_id', parentTable: 'job_work_order_lines' },
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

interface IdMap {
  sales_order_lines?: Record<string, string>;
  job_work_order_lines?: Record<string, string>;
  [k: string]: unknown;
}

async function checkBackfill(transformDir: string, companyId: string): Promise<BackfillCheck> {
  const idMap = JSON.parse(readFileSync(join(transformDir, '_id_map.json'), 'utf8')) as IdMap;
  const soByLegacy = new Map<string, string>(Object.entries(idMap.sales_order_lines ?? {}));
  const jwByLegacy = new Map<string, string>(Object.entries(idMap.job_work_order_lines ?? {}));

  const jcs = (await rawSql`
    SELECT id, code, source_legacy_ref, source_so_line_id, source_jw_line_id
    FROM public.job_cards
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      AND source_legacy_ref IS NOT NULL
  `) as unknown as Array<{
    id: string;
    code: string;
    source_legacy_ref: string | null;
    source_so_line_id: string | null;
    source_jw_line_id: string | null;
  }>;

  const rows: BackfillJcRow[] = [];
  const fkIssues: BackfillJcRow[] = [];
  const legacyUnresolved: BackfillJcRow[] = [];
  let verified = 0;

  for (const jc of jcs) {
    if (!jc.source_legacy_ref) {
      const r: BackfillJcRow = { jcId: jc.id, jcCode: jc.code, status: 'no_legacy_ref' };
      rows.push(r);
      legacyUnresolved.push(r);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jc.source_legacy_ref) as Record<string, unknown>;
    } catch {
      const r: BackfillJcRow = {
        jcId: jc.id,
        jcCode: jc.code,
        status: 'json_parse_failed',
      };
      rows.push(r);
      legacyUnresolved.push(r);
      continue;
    }

    const soRefId =
      typeof parsed['soRefId'] === 'string' && parsed['soRefId'].length > 0
        ? (parsed['soRefId'] as string)
        : null;
    const jwRefId =
      typeof parsed['jwRefId'] === 'string' && parsed['jwRefId'].length > 0
        ? (parsed['jwRefId'] as string)
        : typeof parsed['jwLineRefId'] === 'string' && parsed['jwLineRefId'].length > 0
          ? (parsed['jwLineRefId'] as string)
          : null;

    let expectedColumn: 'source_so_line_id' | 'source_jw_line_id' | null = null;
    let expectedTarget: string | null = null;
    let legacyTargetId: string | null = null;

    if (soRefId) {
      legacyTargetId = soRefId;
      const target = soByLegacy.get(soRefId);
      if (target) {
        expectedColumn = 'source_so_line_id';
        expectedTarget = target;
      }
    } else if (jwRefId) {
      legacyTargetId = jwRefId;
      const target = jwByLegacy.get(jwRefId);
      if (target) {
        expectedColumn = 'source_jw_line_id';
        expectedTarget = target;
      }
    }

    if (!soRefId && !jwRefId) {
      const r: BackfillJcRow = {
        jcId: jc.id,
        jcCode: jc.code,
        status: 'no_so_or_jw_ref_in_payload',
      };
      rows.push(r);
      legacyUnresolved.push(r);
      continue;
    }

    if (expectedColumn === null) {
      // The legacy refId doesn't exist in the transform output (e.g. a
      // missing source SO line). Audit-only, not a failure.
      const r: BackfillJcRow = {
        jcId: jc.id,
        jcCode: jc.code,
        status: 'legacy_ref_unresolved',
        actualSo: jc.source_so_line_id,
        actualJw: jc.source_jw_line_id,
        ...(legacyTargetId !== null ? { legacyTargetId } : {}),
      };
      rows.push(r);
      legacyUnresolved.push(r);
      continue;
    }

    const actualVal =
      expectedColumn === 'source_so_line_id' ? jc.source_so_line_id : jc.source_jw_line_id;
    if (actualVal === expectedTarget) {
      verified++;
      rows.push({
        jcId: jc.id,
        jcCode: jc.code,
        status: expectedColumn === 'source_so_line_id' ? 'verified_so' : 'verified_jw',
        expectedColumn,
        ...(expectedTarget !== null ? { expectedTarget } : {}),
        ...(legacyTargetId !== null ? { legacyTargetId } : {}),
      });
    } else if (actualVal === null) {
      const r: BackfillJcRow = {
        jcId: jc.id,
        jcCode: jc.code,
        status: 'fk_missing',
        expectedColumn,
        actualSo: jc.source_so_line_id,
        actualJw: jc.source_jw_line_id,
        ...(expectedTarget !== null ? { expectedTarget } : {}),
        ...(legacyTargetId !== null ? { legacyTargetId } : {}),
      };
      rows.push(r);
      fkIssues.push(r);
    } else {
      const r: BackfillJcRow = {
        jcId: jc.id,
        jcCode: jc.code,
        status: 'fk_mismatch',
        expectedColumn,
        actualSo: jc.source_so_line_id,
        actualJw: jc.source_jw_line_id,
        ...(expectedTarget !== null ? { expectedTarget } : {}),
        ...(legacyTargetId !== null ? { legacyTargetId } : {}),
      };
      rows.push(r);
      fkIssues.push(r);
    }
  }

  return {
    jcsExamined: jcs.length,
    verified,
    fkIssues,
    legacyUnresolved,
    rows,
    status: fkIssues.length === 0 ? 'OK' : 'FK_ISSUES_FOUND',
  };
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..');
  const transformDir = join(repoRoot, 'migration', 'transform');
  const outDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(outDir, { recursive: true });

  log('info', 'phase4_validation_starting');

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

  const backfill = await checkBackfill(transformDir, companyId);
  log('info', 'backfill_check', {
    examined: backfill.jcsExamined,
    verified: backfill.verified,
    fkIssues: backfill.fkIssues.length,
    legacyUnresolved: backfill.legacyUnresolved.length,
    status: backfill.status,
  });

  const tableFails = tableResults.filter(
    (r) => r.diffStatus === 'MISMATCH' || r.countStatus === 'MISMATCH',
  );
  const orphanFails = orphanChecks.filter((c) => c.status === 'ORPHANS_FOUND');
  const backfillFail = backfill.status !== 'OK';
  const overall: 'PASS' | 'FAIL' =
    tableFails.length === 0 && orphanFails.length === 0 && !backfillFail ? 'PASS' : 'FAIL';

  const summary =
    overall === 'PASS'
      ? `Phase 4 sales chain validated: ${TABLES.length}/${TABLES.length} tables match transform; 0 orphan FKs across ${FK_CHECKS.length} checks; ${backfill.verified}/${backfill.jcsExamined} JC source FKs verified (${backfill.legacyUnresolved.length} audit-only legacy unresolved)`
      : `Phase 4 validation FAILED: ${tableFails.length} table mismatch(es), ${orphanFails.length} orphan FK group(s), ${backfill.fkIssues.length} JC backfill FK issue(s)`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: tableResults,
    orphanChecks,
    backfill,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase4_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase4_validation_complete', {
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
