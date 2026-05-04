// migration/validate-phase5.ts
//
// T-035c — Phase 5 sign-off validation.
//
// What this script verifies:
//   1. Field-level diff: for every transform row across the 6 new tables, the
//      corresponding DB row matches on every mapped column.
//   2. Orphan FK checks: every FK column points to an existing parent row,
//      including the 2 new FKs on `jc_ops` (outsource_pr_id /
//      outsource_po_line_id) added in T-035b.
//   3. Row counts match the transform output (1 + 1 + 1 + 1 + 3 + 2 = 9).
//   4. jc_op outsource backfill verification: every jc_op with a non-null
//      legacy `outsource_pr_no` / `outsource_po_no` text column has the
//      corresponding new FK column populated, AND the resolved row's `code`
//      matches the legacy text.
//
// Read-only. Output to migration/load-output/_phase5_validation.json.
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx validate-phase5.ts
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration validate:phase5

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

const PURCHASE_REQUEST_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  pr_date: row['prDate'],
  status: row['status'],
  vendor_id: row['vendorId'],
  vendor_code_text: row['vendorCodeText'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  item_name: row['itemName'],
  qty: row['qty'],
  est_cost: row['estCost'],
  required_date: row['requiredDate'],
  source_jc_op_id: row['sourceJcOpId'],
  source_so_line_id: row['sourceSoLineId'],
  operation: row['operation'],
  remarks: row['remarks'],
  approved_by: row['approvedBy'],
  approved_at: row['approvedAt'],
  po_id: row['poId'],
  po_created_at: row['poCreatedAt'],
});

const PURCHASE_ORDER_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  po_date: row['poDate'],
  po_type: row['poType'],
  vendor_id: row['vendorId'],
  vendor_code_text: row['vendorCodeText'],
  status: row['status'],
  due_date: row['dueDate'],
  tax_type: row['taxType'],
  sgst_pct: row['sgstPct'],
  cgst_pct: row['cgstPct'],
  igst_pct: row['igstPct'],
  pr_code_text: row['prCodeText'],
  approved_by: row['approvedBy'],
  approved_at: row['approvedAt'],
  approval_remarks: row['approvalRemarks'],
  remarks: row['remarks'],
});

const PURCHASE_ORDER_LINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  purchase_order_id: row['purchaseOrderId'],
  line_no: row['lineNo'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  item_name: row['itemName'],
  qty: row['qty'],
  rate: row['rate'],
  received_qty: row['receivedQty'],
  due_date: row['dueDate'],
  source_so_line_id: row['sourceSoLineId'],
  source_jc_op_id: row['sourceJcOpId'],
  line_remarks: row['lineRemarks'],
});

const GOODS_RECEIPT_NOTE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  code: row['code'],
  grn_date: row['grnDate'],
  purchase_order_id: row['purchaseOrderId'],
  po_code_text: row['poCodeText'],
  vendor_id: row['vendorId'],
  vendor_code_text: row['vendorCodeText'],
  dc_no: row['dcNo'],
  invoice_no: row['invoiceNo'],
  remarks: row['remarks'],
});

const GOODS_RECEIPT_NOTE_LINE_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  goods_receipt_note_id: row['goodsReceiptNoteId'],
  line_no: row['lineNo'],
  purchase_order_line_id: row['purchaseOrderLineId'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  item_name: row['itemName'],
  received_qty: row['receivedQty'],
  dc_ref_no: row['dcRefNo'],
  qc_status: row['qcStatus'],
  qc_accepted_qty: row['qcAcceptedQty'],
  qc_rejected_qty: row['qcRejectedQty'],
  qc_date: row['qcDate'],
  qc_remarks: row['qcRemarks'],
  qc_inspected_by: row['qcInspectedBy'],
  remarks: row['remarks'],
});

const STORE_TRANSACTION_MAPPER: Mapper<BaseRow> = (row) => ({
  id: row['id'],
  txn_date: row['txnDate'],
  item_id: row['itemId'],
  item_code_text: row['itemCodeText'],
  txn_type: row['txnType'],
  qty: row['qty'],
  source_type: row['sourceType'],
  source_ref: row['sourceRef'],
  stock_before: row['stockBefore'],
  stock_after: row['stockAfter'],
  remarks: row['remarks'],
});

const TABLES = [
  'purchase_requests',
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipt_notes',
  'goods_receipt_note_lines',
  'store_transactions',
] as const;
type TableName = (typeof TABLES)[number];

const MAPPERS: Record<TableName, Mapper<BaseRow>> = {
  purchase_requests: PURCHASE_REQUEST_MAPPER,
  purchase_orders: PURCHASE_ORDER_MAPPER,
  purchase_order_lines: PURCHASE_ORDER_LINE_MAPPER,
  goods_receipt_notes: GOODS_RECEIPT_NOTE_MAPPER,
  goods_receipt_note_lines: GOODS_RECEIPT_NOTE_LINE_MAPPER,
  store_transactions: STORE_TRANSACTION_MAPPER,
};

// store_transactions has no `deleted_at` (append-only per ADR-015 #4); other
// Phase 5 tables follow the standard pattern.
const TABLES_WITH_DELETED_AT: ReadonlySet<TableName> = new Set([
  'purchase_requests',
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipt_notes',
  'goods_receipt_note_lines',
]);

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

// jc_op outsource backfill cross-check removed in Phase 5 cleanup —
// the legacy text columns it cross-checked against (outsource_pr_no /
// outsource_po_no) were dropped by 0014_phase5_jc_ops_drop_legacy.sql.
// The orphan FK checks on outsource_pr_id + outsource_po_line_id (in
// FK_CHECKS) are the proper post-drop verification.

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
  // Postgres timestamptz comes back as `YYYY-MM-DD HH:MM:SS+TZ`; transform
  // emits ISO `YYYY-MM-DDTHH:MM:SSZ`. Normalise both to a Date.toISOString().
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return v;
}

async function validateTable(
  table: TableName,
  transformDir: string,
  companyId: string,
): Promise<TableValidation> {
  const file = readTransform<BaseRow>(table, transformDir);
  const mapper = MAPPERS[table];
  const hasSoftDelete = TABLES_WITH_DELETED_AT.has(table);

  const dbRows = hasSoftDelete
    ? ((await rawSql<DbRow[]>`
        SELECT * FROM ${rawSql(table)}
        WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
      `) as unknown as DbRow[])
    : ((await rawSql<DbRow[]>`
        SELECT * FROM ${rawSql(table)}
        WHERE company_id = ${companyId}::uuid
      `) as unknown as DbRow[]);

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
// Includes the 2 new FKs on `jc_ops` from ADR-015 #5.
const FK_CHECKS: Array<{ table: string; column: string; parentTable: string }> = [
  // purchase_requests
  { table: 'purchase_requests', column: 'vendor_id', parentTable: 'vendors' },
  { table: 'purchase_requests', column: 'item_id', parentTable: 'items' },
  { table: 'purchase_requests', column: 'source_jc_op_id', parentTable: 'jc_ops' },
  { table: 'purchase_requests', column: 'source_so_line_id', parentTable: 'sales_order_lines' },
  { table: 'purchase_requests', column: 'po_id', parentTable: 'purchase_orders' },
  { table: 'purchase_requests', column: 'approved_by', parentTable: 'users' },
  { table: 'purchase_requests', column: 'created_by', parentTable: 'users' },
  { table: 'purchase_requests', column: 'updated_by', parentTable: 'users' },
  // purchase_orders
  { table: 'purchase_orders', column: 'vendor_id', parentTable: 'vendors' },
  { table: 'purchase_orders', column: 'approved_by', parentTable: 'users' },
  { table: 'purchase_orders', column: 'created_by', parentTable: 'users' },
  { table: 'purchase_orders', column: 'updated_by', parentTable: 'users' },
  // purchase_order_lines
  { table: 'purchase_order_lines', column: 'purchase_order_id', parentTable: 'purchase_orders' },
  { table: 'purchase_order_lines', column: 'item_id', parentTable: 'items' },
  {
    table: 'purchase_order_lines',
    column: 'source_so_line_id',
    parentTable: 'sales_order_lines',
  },
  { table: 'purchase_order_lines', column: 'source_jc_op_id', parentTable: 'jc_ops' },
  { table: 'purchase_order_lines', column: 'created_by', parentTable: 'users' },
  { table: 'purchase_order_lines', column: 'updated_by', parentTable: 'users' },
  // goods_receipt_notes
  { table: 'goods_receipt_notes', column: 'purchase_order_id', parentTable: 'purchase_orders' },
  { table: 'goods_receipt_notes', column: 'vendor_id', parentTable: 'vendors' },
  { table: 'goods_receipt_notes', column: 'created_by', parentTable: 'users' },
  { table: 'goods_receipt_notes', column: 'updated_by', parentTable: 'users' },
  // goods_receipt_note_lines
  {
    table: 'goods_receipt_note_lines',
    column: 'goods_receipt_note_id',
    parentTable: 'goods_receipt_notes',
  },
  {
    table: 'goods_receipt_note_lines',
    column: 'purchase_order_line_id',
    parentTable: 'purchase_order_lines',
  },
  { table: 'goods_receipt_note_lines', column: 'item_id', parentTable: 'items' },
  { table: 'goods_receipt_note_lines', column: 'qc_inspected_by', parentTable: 'users' },
  { table: 'goods_receipt_note_lines', column: 'created_by', parentTable: 'users' },
  { table: 'goods_receipt_note_lines', column: 'updated_by', parentTable: 'users' },
  // store_transactions (created-only audit)
  { table: 'store_transactions', column: 'item_id', parentTable: 'items' },
  { table: 'store_transactions', column: 'created_by', parentTable: 'users' },
  // jc_ops new FKs from ADR-015 #5
  { table: 'jc_ops', column: 'outsource_pr_id', parentTable: 'purchase_requests' },
  { table: 'jc_ops', column: 'outsource_po_line_id', parentTable: 'purchase_order_lines' },
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

  log('info', 'phase5_validation_starting');

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
      ? `Phase 5 procurement validated: ${TABLES.length}/${TABLES.length} tables match transform; 0 orphan FKs across ${FK_CHECKS.length} checks (incl. outsource_pr_id + outsource_po_line_id post-drop)`
      : `Phase 5 validation FAILED: ${tableFails.length} table mismatch(es), ${orphanFails.length} orphan FK group(s)`;

  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    companyId,
    tables: tableResults,
    orphanChecks,
    overallStatus: overall,
    summary,
  };

  const outPath = join(outDir, '_phase5_validation.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'phase5_validation_complete', {
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
