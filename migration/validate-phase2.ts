// migration/validate-phase2.ts
//
// T-023 — Phase 2 sign-off validation.
//
// What this script verifies:
//   1. Field-level diff: for every transform row, the corresponding DB row
//      matches on every mapped column (no silent data loss in the load).
//   2. Orphan FK check: created_by / updated_by on every Phase 2 master
//      table point to existing users; operators.user_id (nullable) is null
//      OR points to an existing user.
//   3. Row counts match the transform (modulo known users delta from
//      T-012 smoke).
//
// This script is read-only (zero writes). Output is written to
//   migration/load-output/_phase2_validation.json
// alongside the per-load _validation.json from T-015.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase2.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase2

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

const ITEM_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  description: row['description'],
  drawing_no: row['drawingNo'],
  revision: row['revision'],
  material: row['material'],
  uom: row['uom'],
  drawing_file_path: row['drawingFilePath'],
});

const CLIENT_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  contact_person: row['contactPerson'],
  email: row['email'],
  phone: row['phone'],
  gst_number: row['gstNumber'],
  address_line1: row['addressLine1'],
  city: row['city'],
  state: row['state'],
  pincode: row['pincode'],
  is_active: row['isActive'],
});

const VENDOR_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  contact_person: row['contactPerson'],
  email: row['email'],
  phone: row['phone'],
  gst_number: row['gstNumber'],
  address_line1: row['addressLine1'],
  city: row['city'],
  state: row['state'],
  pincode: row['pincode'],
  materials_supplied: row['materialsSupplied'],
  rating: row['rating'],
  is_active: row['isActive'],
});

const MACHINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  machine_type: row['machineType'],
  capacity_per_shift: row['capacityPerShift'],
  shifts_per_day: row['shiftsPerDay'],
  status: row['status'],
});

const OPERATOR_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  department: row['department'],
  skills: row['skills'],
  is_active: row['isActive'],
  user_id: row['userId'],
});

const TABLES = ['items', 'clients', 'vendors', 'machines', 'operators'] as const;
type TableName = (typeof TABLES)[number];

const MAPPERS: Record<TableName, Mapper<BaseRow>> = {
  items: ITEM_MAPPER,
  clients: CLIENT_MAPPER,
  vendors: VENDOR_MAPPER,
  machines: MACHINE_MAPPER,
  operators: OPERATOR_MAPPER,
};

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
  table: TableName | 'users';
  column: string;
  orphanCount: number;
  status: 'OK' | 'ORPHANS_FOUND';
}

interface UsersValidation {
  transformRowCount: number;
  dbCount: number;
  knownDelta: string;
  status: 'OK' | 'MISMATCH';
}

interface ValidationReport {
  generatedAt: string;
  companyId: string;
  tables: TableValidation[];
  users: UsersValidation;
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

async function validateUsers(transformDir: string, companyId: string): Promise<UsersValidation> {
  const file = readTransform<BaseRow>('users', transformDir);
  const dbRows = await rawSql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM public.users
    WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
  `;
  const dbCount = dbRows[0]?.c ?? 0;
  const expectedWithSmokeUser = file.rowCount + 1;
  const status: 'OK' | 'MISMATCH' = dbCount === expectedWithSmokeUser ? 'OK' : 'MISMATCH';
  return {
    transformRowCount: file.rowCount,
    dbCount,
    knownDelta: 'expected dbCount = transformRowCount + 1 (viewer@innovic.test from T-012 smoke)',
    status,
  };
}

async function checkOrphans(): Promise<OrphanCheck[]> {
  const checks: OrphanCheck[] = [];

  for (const table of TABLES) {
    for (const col of ['created_by', 'updated_by'] as const) {
      const rows = await rawSql<Array<{ c: number }>>`
        SELECT count(*)::int AS c FROM ${rawSql(table)} t
        WHERE t.${rawSql(col)} IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = t.${rawSql(col)})
      `;
      const orphanCount = rows[0]?.c ?? 0;
      checks.push({
        table,
        column: col,
        orphanCount,
        status: orphanCount === 0 ? 'OK' : 'ORPHANS_FOUND',
      });
    }
  }

  // operators.user_id (nullable; only orphans if not-null but missing)
  const opUserIdRows = await rawSql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM operators o
    WHERE o.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = o.user_id)
  `;
  const opUserIdOrphans = opUserIdRows[0]?.c ?? 0;
  checks.push({
    table: 'operators',
    column: 'user_id',
    orphanCount: opUserIdOrphans,
    status: opUserIdOrphans === 0 ? 'OK' : 'ORPHANS_FOUND',
  });

  // users audit columns + company_id
  for (const col of ['created_by', 'updated_by'] as const) {
    const rows = await rawSql<Array<{ c: number }>>`
      SELECT count(*)::int AS c FROM public.users u
      WHERE u.${rawSql(col)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.users u2 WHERE u2.id = u.${rawSql(col)})
    `;
    const orphanCount = rows[0]?.c ?? 0;
    checks.push({
      table: 'users',
      column: col,
      orphanCount,
      status: orphanCount === 0 ? 'OK' : 'ORPHANS_FOUND',
    });
  }

  const usersCompanyRows = await rawSql<Array<{ c: number }>>`
    SELECT count(*)::int AS c FROM public.users u
    WHERE u.company_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = u.company_id)
  `;
  const usersCompanyOrphans = usersCompanyRows[0]?.c ?? 0;
  checks.push({
    table: 'users',
    column: 'company_id',
    orphanCount: usersCompanyOrphans,
    status: usersCompanyOrphans === 0 ? 'OK' : 'ORPHANS_FOUND',
  });

  return checks;
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..');
  const transformDir = join(repoRoot, 'migration', 'transform');
  const outDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(outDir, { recursive: true });

  log('info', 'phase2_validation_starting');

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

  const usersResult = await validateUsers(transformDir, companyId);
  log('info', 'users_validated', { ...usersResult });

  const orphanChecks = await checkOrphans();
  for (const c of orphanChecks) {
    log('info', 'orphan_check', { ...c });
  }

  const tableFails = tableResults.filter(
    (r) => r.diffStatus === 'MISMATCH' || r.countStatus === 'MISMATCH',
  );
  const orphanFails = orphanChecks.filter((c) => c.status === 'ORPHANS_FOUND');
  const usersFail = usersResult.status === 'MISMATCH';
  const overall: 'PASS' | 'FAIL' =
    tableFails.length === 0 && orphanFails.length === 0 && !usersFail ? 'PASS' : 'FAIL';

  const summary =
    overall === 'PASS'
      ? 'Phase 2 master data validated: all 5 master tables match transform; no orphan FKs; users delta matches known T-012 smoke leftover'
      : `Phase 2 validation FAILED: ${tableFails.length} table mismatch(es), ${orphanFails.length} orphan FK group(s)${usersFail ? ', users count off' : ''}`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: tableResults,
    users: usersResult,
    orphanChecks,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase2_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase2_validation_complete', {
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
