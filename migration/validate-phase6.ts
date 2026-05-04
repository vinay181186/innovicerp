// migration/validate-phase6.ts
//
// T-038 + T-039 — Phase 6 sign-off validation.
//
// What this script verifies:
//   1. Field-level diff: for every transform row, the corresponding DB row
//      matches on every mapped column. Tables: qc_processes (T-038),
//      nc_register, delivery_challans, delivery_challan_lines (T-039).
//   2. Orphan FK checks: business FKs (job_card_id, item_id, vendor_id,
//      delivery_challan_id) and audit FKs (created_by, updated_by) point at
//      existing rows.
//   3. Row counts match transform output (5 + 3 + 4 + 4 = 16).
//
// Legacy `dispatch_log`, `jwDCOutward`, `jwDCInward`, `partyMaterials`,
// `partyGrn`, `ospDC`, `outsourceJobs`, `storeIssues` are all doc_missing —
// not migrated, recorded in MIGRATION-LOG. Per-inspection record table is
// deferred to T-040 (ADR-016).
//
// Read-only. Output to migration/load-output/_phase6_validation.json.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase6.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase6

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

const QC_PROCESS_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  description: row['description'],
  default_cycle_time_min: row['defaultCycleTimeMin'],
  is_active: row['isActive'],
});

const NC_REGISTER_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  nc_date: row['ncDate'],
  job_card_id: row['jobCardId'],
  jc_op_id: row['jcOpId'],
  op_seq: row['opSeq'],
  operation_text: row['operationText'],
  qc_operation_text: row['qcOperationText'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  item_name_text: row['itemNameText'],
  so_code_text: row['soCodeText'],
  machine_code_text: row['machineCodeText'],
  rejected_qty: row['rejectedQty'],
  reason_category: row['reasonCategory'],
  reason: row['reason'],
  disposition: row['disposition'],
  disposition_date: row['dispositionDate'],
  disposition_by_text: row['dispositionByText'],
  disposition_remarks: row['dispositionRemarks'],
  rework_jc_code_text: row['reworkJcCodeText'],
  rework_op_seq: row['reworkOpSeq'],
  rework_done_qty: row['reworkDoneQty'],
  scrap_cost: row['scrapCost'],
  status: row['status'],
  reported_by_text: row['reportedByText'],
  // time_logged is timestamptz; transform serialises to ISO string. The
  // diff comparison only kicks in when both sides are non-null.
  time_logged: row['timeLogged'],
});

const DELIVERY_CHALLAN_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  dc_date: row['dcDate'],
  purchase_order_id: row['purchaseOrderId'],
  po_code_text: row['poCodeText'],
  vendor_id: row['vendorId'],
  vendor_code_text: row['vendorCodeText'],
  sales_order_line_id: row['salesOrderLineId'],
  so_ref_text: row['soRefText'],
  transport: row['transport'],
  status: row['status'],
});

const DELIVERY_CHALLAN_LINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  delivery_challan_id: row['deliveryChallanId'],
  line_no: row['lineNo'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  item_name_text: row['itemNameText'],
  qty: row['qty'],
  uom: row['uom'],
  material_text: row['materialText'],
  dc_remarks: row['dcRemarks'],
});

const TABLES = [
  'qc_processes',
  'nc_register',
  'delivery_challans',
  'delivery_challan_lines',
] as const;
type TableName = (typeof TABLES)[number];

const MAPPERS: Record<TableName, Mapper<BaseRow>> = {
  qc_processes: QC_PROCESS_MAPPER,
  nc_register: NC_REGISTER_MAPPER,
  delivery_challans: DELIVERY_CHALLAN_MAPPER,
  delivery_challan_lines: DELIVERY_CHALLAN_LINE_MAPPER,
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

const FK_CHECKS: Array<{ table: string; column: string; parentTable: string }> = [
  { table: 'qc_processes', column: 'created_by', parentTable: 'users' },
  { table: 'qc_processes', column: 'updated_by', parentTable: 'users' },
  { table: 'nc_register', column: 'job_card_id', parentTable: 'job_cards' },
  { table: 'nc_register', column: 'jc_op_id', parentTable: 'jc_ops' },
  { table: 'nc_register', column: 'item_id', parentTable: 'items' },
  { table: 'nc_register', column: 'created_by', parentTable: 'users' },
  { table: 'nc_register', column: 'updated_by', parentTable: 'users' },
  { table: 'delivery_challans', column: 'purchase_order_id', parentTable: 'purchase_orders' },
  { table: 'delivery_challans', column: 'vendor_id', parentTable: 'vendors' },
  { table: 'delivery_challans', column: 'sales_order_line_id', parentTable: 'sales_order_lines' },
  { table: 'delivery_challans', column: 'created_by', parentTable: 'users' },
  { table: 'delivery_challans', column: 'updated_by', parentTable: 'users' },
  {
    table: 'delivery_challan_lines',
    column: 'delivery_challan_id',
    parentTable: 'delivery_challans',
  },
  { table: 'delivery_challan_lines', column: 'item_id', parentTable: 'items' },
  { table: 'delivery_challan_lines', column: 'created_by', parentTable: 'users' },
  { table: 'delivery_challan_lines', column: 'updated_by', parentTable: 'users' },
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

  log('info', 'phase6_validation_starting');

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

  const tableFails = tableResults.filter(
    (r) => r.diffStatus === 'MISMATCH' || r.countStatus === 'MISMATCH',
  );
  const orphanFails = orphanChecks.filter((c) => c.status === 'ORPHANS_FOUND');
  const overall: 'PASS' | 'FAIL' =
    tableFails.length === 0 && orphanFails.length === 0 ? 'PASS' : 'FAIL';

  const summary =
    overall === 'PASS'
      ? `Phase 6 validated end-to-end: ${TABLES.length}/${TABLES.length} tables match transform (qc_processes + nc_register + delivery_challans + delivery_challan_lines); 0 orphan FKs across ${FK_CHECKS.length} checks. Legacy dispatch_log + JW DC + party_grn collections were doc_missing in the export and are intentionally not migrated (ADR-017 #1).`
      : `Phase 6 validation FAILED: ${tableFails.length} table mismatch(es), ${orphanFails.length} orphan FK group(s)`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: tableResults,
    orphanChecks,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase6_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase6_validation_complete', {
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
