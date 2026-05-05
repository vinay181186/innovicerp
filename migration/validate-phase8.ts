// migration/validate-phase8.ts
//
// T-051 — Phase 8 sign-off validation. Single table: activity_log.
//
// Verifies:
//   1. Field-level diff: every transformed row matches the DB row on every
//      mapped column.
//   2. Row count matches transform output (14 expected from Run 1 export).
//   3. Orphan FK checks: user_id (where set) and created_by point at
//      existing users.
//
// Note: activity_log has no deleted_at — append-only per ADR-019. The
// validation reads all rows for the company.
//
// Read-only. Output to migration/load-output/_phase8_validation.json.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase8.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase8

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

const ACTIVITY_LOG_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  ts: row['ts'],
  user_id: row['userId'],
  user_name: row['userName'],
  action: row['action'],
  entity: row['entity'],
  detail: row['detail'],
  ref_id: row['refId'],
});

interface FieldDiff {
  legacyId: string;
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

interface TableValidation {
  table: string;
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

interface ValidationReport {
  generatedAt: string;
  companyId: string;
  tables: TableValidation[];
  orphanChecks: OrphanCheck[];
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

// Postgres-js returns timestamptz as a string in PG wire format
// ('2026-04-29 14:54:20.514+00') vs the transform's ISO string. Normalise
// both sides to ISO so the diff doesn't trip on formatting.
function normaliseTs(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v;
}

async function validateActivityLog(
  transformDir: string,
  companyId: string,
): Promise<TableValidation> {
  const file = readTransform<BaseRow>('activity_log', transformDir);

  // No deleted_at filter — append-only.
  const dbRows = (await rawSql<DbRow[]>`
    SELECT * FROM public.activity_log
    WHERE company_id = ${companyId}::uuid
  `) as unknown as DbRow[];

  const dbById = new Map<string, DbRow>();
  for (const r of dbRows) dbById.set(String(r['id']), r);

  const fieldDiffs: FieldDiff[] = [];
  const missing: string[] = [];
  let matched = 0;

  for (const transformRow of file.rows) {
    const expected = ACTIVITY_LOG_MAPPER(transformRow);
    const id = String(expected['id']);
    const dbRow = dbById.get(id);
    if (!dbRow) {
      missing.push(transformRow._legacyId);
      continue;
    }
    matched++;
    for (const [col, expectedVal] of Object.entries(expected)) {
      if (col === 'id') continue;
      const actualVal = col === 'ts' ? normaliseTs(dbRow[col]) : normalise(dbRow[col]);
      const expectedNorm = col === 'ts' ? normaliseTs(expectedVal) : normalise(expectedVal);
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
    table: 'activity_log',
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

const FK_CHECKS: Array<{ table: string; column: string; parentTable: string }> = [
  { table: 'activity_log', column: 'user_id', parentTable: 'users' },
  { table: 'activity_log', column: 'created_by', parentTable: 'users' },
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

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..');
  const transformDir = join(repoRoot, 'migration', 'transform');
  const outDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(outDir, { recursive: true });

  log('info', 'phase8_validation_starting');

  const companyId = await resolveCompanyId();
  log('info', 'company_resolved', { companyId });

  const tableResult = await validateActivityLog(transformDir, companyId);
  log('info', 'table_validated', {
    table: tableResult.table,
    transform: tableResult.transformRowCount,
    db: tableResult.dbCount,
    matched: tableResult.matchedRows,
    fieldDiffs: tableResult.fieldDiffs.length,
    missing: tableResult.missingFromDb.length,
    countStatus: tableResult.countStatus,
    diffStatus: tableResult.diffStatus,
  });

  const orphanChecks = await checkOrphans();
  for (const c of orphanChecks) {
    log('info', 'orphan_check', { ...c });
  }

  const tableFails =
    tableResult.diffStatus === 'MISMATCH' || tableResult.countStatus === 'MISMATCH' ? 1 : 0;
  const orphanFails = orphanChecks.filter((c) => c.status === 'ORPHANS_FOUND');
  const overall: 'PASS' | 'FAIL' = tableFails === 0 && orphanFails.length === 0 ? 'PASS' : 'FAIL';

  const summary =
    overall === 'PASS'
      ? `Phase 8 validated: 1/1 tables match transform (activity_log: ${tableResult.dbCount} rows); 0 orphan FKs across ${FK_CHECKS.length} checks (user_id + created_by). Legacy "Japan" entries land with user_id=null per ADR-019 — snapshot user_name preserves the audit trail.`
      : `Phase 8 validation FAILED: ${tableFails} table mismatch, ${orphanFails.length} orphan FK group(s)`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: [tableResult],
    orphanChecks,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase8_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase8_validation_complete', {
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
