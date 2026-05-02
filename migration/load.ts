// migration/load.ts
//
// T-015 (Phase 2) + T-024d (Phase 3) + T-029d (Phase 4) + T-035c (Phase 5) —
// Bulk-load transform output into Supabase Postgres.
//
// Reads migration/transform/<table>.json (output of T-014 / T-024c / T-029c /
// T-035c), resolves the runtime context (seed company id + admin user id),
// invokes the users loader (special two-phase) and the generic bulk loader
// for everything else, then runs the JC source FK backfill (Phase 4) and the
// jc_op outsource backfill (Phase 5) and writes a load report.
//
// Per-table config (mapper + conflict target + audit shape) lives in
// TABLE_CONFIGS below. Phase 3 tables use deterministic (id) conflict targets
// where they have no business unique key (op_log, running_ops); the rest mirror
// the Phase 2 (company_id, code) WHERE deleted_at IS NULL pattern adapted to
// their own composite uniques.
//
// Usage:
//   pnpm --filter @innovic/migration load
//   pnpm --filter @innovic/migration load -- --only=items
//   pnpm --filter @innovic/migration load -- --only=route_cards,route_card_ops
//   pnpm --filter @innovic/migration load -- --only=sales_orders,sales_order_lines,job_work_orders,job_work_order_lines
//   pnpm --filter @innovic/migration load -- --dry-run

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type AuditShape, bulkLoad, type BulkLoadConfig } from './load/bulk-loader';
import { closeDb, rawSql } from './load/db';
import {
  type OutsourceBackfillResult,
  runJcOpOutsourceBackfill,
} from './load/jc-op-outsource-backfill';
import { type BackfillResult, runJcSourceBackfill } from './load/jc-source-backfill';
import type { IdMapPersisted, LoadResult, UserLoadOutcome } from './load/types';
import { loadUsers } from './load/users-loader';
import { validateOne, type ValidationEntry } from './load/validate';

interface TransformedRow {
  _legacyId: string;
  [k: string]: unknown;
}

interface TransformedFile<T> {
  table: string;
  sourceCollection: string;
  transformedAt: string;
  rowCount: number;
  rows: T[];
}

// ─── Per-table mappers ────────────────────────────────────────────────────

type Mapper = BulkLoadConfig<TransformedRow>['toRow'];

const ITEM_MAPPER: Mapper = (row) => ({
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

const CLIENT_MAPPER: Mapper = (row) => ({
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

const VENDOR_MAPPER: Mapper = (row) => ({
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

const MACHINE_MAPPER: Mapper = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  machine_type: row['machineType'],
  capacity_per_shift: row['capacityPerShift'],
  shifts_per_day: row['shiftsPerDay'],
  status: row['status'],
});

const OPERATOR_MAPPER: Mapper = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  department: row['department'],
  skills: row['skills'],
  is_active: row['isActive'],
  user_id: row['userId'],
});

const ROUTE_CARD_MAPPER: Mapper = (row) => ({
  id: row['id'],
  code: row['code'],
  item_id: row['itemId'],
  current_revision: row['currentRevision'],
  notes: row['notes'],
});

const ROUTE_CARD_OP_MAPPER: Mapper = (row) => ({
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

const ROUTE_CARD_REVISION_MAPPER: Mapper = (row) => ({
  id: row['id'],
  route_card_id: row['routeCardId'],
  revision_no: row['revisionNo'],
  notes: row['notes'],
  // postgres-js sends a JS array as a Postgres array literal, not jsonb.
  // Stringify here so Postgres receives text and casts to jsonb on the column.
  ops_snapshot: JSON.stringify(row['opsSnapshot'] ?? []),
});

const JOB_CARD_MAPPER: Mapper = (row) => ({
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

const JC_OP_MAPPER: Mapper = (row) => ({
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
  outsource_pr_no: row['outsourcePrNo'],
  outsource_po_no: row['outsourcePoNo'],
  outsource_dc_no: row['outsourceDcNo'],
  outsource_sent_qty: row['outsourceSentQty'],
  outsource_sent_date: row['outsourceSentDate'],
  outsource_returned_qty: row['outsourceReturnedQty'],
});

const OP_LOG_MAPPER: Mapper = (row) => ({
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

const RUNNING_OP_MAPPER: Mapper = (row) => ({
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

const SALES_ORDER_MAPPER: Mapper = (row) => ({
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

const SALES_ORDER_LINE_MAPPER: Mapper = (row) => ({
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

const JOB_WORK_ORDER_MAPPER: Mapper = (row) => ({
  id: row['id'],
  code: row['code'],
  jw_date: row['jwDate'],
  client_id: row['clientId'],
  customer_name: row['customerName'],
  client_po_no: row['clientPoNo'],
  status: row['status'],
  remarks: row['remarks'],
});

const JOB_WORK_ORDER_LINE_MAPPER: Mapper = (row) => ({
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

const PURCHASE_REQUEST_MAPPER: Mapper = (row) => ({
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

const PURCHASE_ORDER_MAPPER: Mapper = (row) => ({
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

const PURCHASE_ORDER_LINE_MAPPER: Mapper = (row) => ({
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

const GOODS_RECEIPT_NOTE_MAPPER: Mapper = (row) => ({
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

const GOODS_RECEIPT_NOTE_LINE_MAPPER: Mapper = (row) => ({
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

const STORE_TRANSACTION_MAPPER: Mapper = (row) => ({
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

const QC_PROCESS_MAPPER: Mapper = (row) => ({
  id: row['id'],
  code: row['code'],
  description: row['description'],
  default_cycle_time_min: row['defaultCycleTimeMin'],
  is_active: row['isActive'],
});

// ─── Per-table config (mapper + conflict + audit) ─────────────────────────

interface TableLoadConfig {
  mapper: Mapper;
  conflictTarget?: string;
  auditColumns?: AuditShape;
}

const TABLE_CONFIGS: Record<string, TableLoadConfig> = {
  // Phase 2 master data — defaults: 'full' audit + (company_id, code) WHERE deleted_at IS NULL
  items: { mapper: ITEM_MAPPER },
  clients: { mapper: CLIENT_MAPPER },
  vendors: { mapper: VENDOR_MAPPER },
  machines: { mapper: MACHINE_MAPPER },
  operators: { mapper: OPERATOR_MAPPER },
  // Phase 3 op-entry chain
  route_cards: { mapper: ROUTE_CARD_MAPPER },
  route_card_ops: {
    mapper: ROUTE_CARD_OP_MAPPER,
    conflictTarget: '(route_card_id, op_seq) WHERE deleted_at IS NULL',
  },
  route_card_revisions: {
    mapper: ROUTE_CARD_REVISION_MAPPER,
    conflictTarget: '(route_card_id, revision_no)',
    auditColumns: 'created_only',
  },
  job_cards: { mapper: JOB_CARD_MAPPER },
  jc_ops: {
    mapper: JC_OP_MAPPER,
    conflictTarget: '(job_card_id, op_seq) WHERE deleted_at IS NULL',
  },
  op_log: {
    mapper: OP_LOG_MAPPER,
    conflictTarget: '(id)',
    auditColumns: 'created_only',
  },
  running_ops: {
    mapper: RUNNING_OP_MAPPER,
    conflictTarget: '(id)',
  },
  // Phase 4 sales chain
  sales_orders: { mapper: SALES_ORDER_MAPPER },
  sales_order_lines: {
    mapper: SALES_ORDER_LINE_MAPPER,
    conflictTarget: '(sales_order_id, line_no) WHERE deleted_at IS NULL',
  },
  job_work_orders: { mapper: JOB_WORK_ORDER_MAPPER },
  job_work_order_lines: {
    mapper: JOB_WORK_ORDER_LINE_MAPPER,
    conflictTarget: '(job_work_order_id, line_no) WHERE deleted_at IS NULL',
  },
  // Phase 5 procurement
  purchase_orders: { mapper: PURCHASE_ORDER_MAPPER },
  purchase_requests: { mapper: PURCHASE_REQUEST_MAPPER },
  purchase_order_lines: {
    mapper: PURCHASE_ORDER_LINE_MAPPER,
    conflictTarget: '(purchase_order_id, line_no) WHERE deleted_at IS NULL',
  },
  goods_receipt_notes: { mapper: GOODS_RECEIPT_NOTE_MAPPER },
  goods_receipt_note_lines: {
    mapper: GOODS_RECEIPT_NOTE_LINE_MAPPER,
    conflictTarget: '(goods_receipt_note_id, line_no) WHERE deleted_at IS NULL',
  },
  // store_transactions: append-only ledger; no business unique key + no
  // updated_*/deleted_at columns. Per ADR-015 #4 (matches op_log).
  store_transactions: {
    mapper: STORE_TRANSACTION_MAPPER,
    conflictTarget: '(id)',
    auditColumns: 'created_only',
  },
  // Phase 6 master (T-038)
  qc_processes: { mapper: QC_PROCESS_MAPPER },
};

// FK-dependency order. users first (special path); then masters; then Phase 3
// in the order route_cards/job_cards (siblings, both depend on items) → jc_ops
// (depends on job_cards + machines + vendors) → op_log (depends on jc_ops +
// operators) → running_ops (depends on jc_ops + machines + operators); then
// Phase 4: sales_orders (depends on clients) → sales_order_lines (depends on
// sales_orders + items) → job_work_orders (depends on clients) →
// job_work_order_lines (depends on job_work_orders + items); then Phase 5:
// purchase_orders (depends on vendors) → purchase_requests (depends on PO
// header via po_id) → purchase_order_lines (depends on PO + items) →
// goods_receipt_notes (depends on PO) → goods_receipt_note_lines (depends on
// GRN + PO_lines) → store_transactions (depends on items). The JC source FK
// backfill runs after the SO/JW line tables are loaded — see
// runJcSourceBackfill. The jc_op outsource backfill runs after the PO + PO
// line tables are loaded — see runJcOpOutsourceBackfill.
const ALL_TABLES = [
  'users',
  'clients',
  'vendors',
  'items',
  'machines',
  'operators',
  'route_cards',
  'route_card_ops',
  'route_card_revisions',
  'job_cards',
  'jc_ops',
  'op_log',
  'running_ops',
  'sales_orders',
  'sales_order_lines',
  'job_work_orders',
  'job_work_order_lines',
  'purchase_orders',
  'purchase_requests',
  'purchase_order_lines',
  'goods_receipt_notes',
  'goods_receipt_note_lines',
  'store_transactions',
  // Phase 6 master — no FK dependencies on Phase 2-5 tables (per ADR-016 #3
  // jc_ops.operation stays text, no FK to qc_processes).
  'qc_processes',
] as const;
type TableName = (typeof ALL_TABLES)[number];

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

function readTransform<T>(table: TableName, transformDir: string): TransformedFile<T> {
  const path = join(transformDir, `${table}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as TransformedFile<T>;
}

async function resolveSeedContext(): Promise<{ companyId: string; adminUserId: string }> {
  const adminEmail = 'innovic.technology@gmail.com';
  const company = await rawSql<Array<{ id: string }>>`
    SELECT id FROM public.companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  const companyId = company[0]?.id;
  if (!companyId) {
    throw new Error('No company in public.companies — run the seed admin script first');
  }
  const admin = await rawSql<Array<{ id: string }>>`
    SELECT id FROM public.users WHERE lower(email) = ${adminEmail} AND deleted_at IS NULL LIMIT 1
  `;
  const adminUserId = admin[0]?.id;
  if (!adminUserId) {
    throw new Error(`Seed admin (${adminEmail}) not found in public.users`);
  }
  return { companyId, adminUserId };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const dryRun = values['dry-run'] === true;
  const filter = values.only
    ? values.only
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  if (filter) {
    const unknown = filter.filter((c) => !ALL_TABLES.includes(c as TableName));
    if (unknown.length > 0) {
      log('error', 'unknown_tables', { unknown });
      process.exit(1);
    }
  }
  const targets: TableName[] = filter ? (filter as TableName[]) : [...ALL_TABLES];

  const repoRoot = resolve(import.meta.dirname, '..');
  const transformDir = join(repoRoot, 'migration', 'transform');
  const loadDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(loadDir, { recursive: true });

  log('info', 'load_starting', { dryRun, targets });

  const seed = await resolveSeedContext();
  log('info', 'seed_context_resolved', { companyId: seed.companyId, adminUserId: seed.adminUserId });

  const idMapPath = join(transformDir, '_id_map.json');
  const idMap = JSON.parse(readFileSync(idMapPath, 'utf8')) as IdMapPersisted;

  const loadResults: LoadResult[] = [];
  const userOutcomes: UserLoadOutcome[] = [];

  // Phase A — users.
  if (targets.includes('users')) {
    const usersFile = readTransform<TransformedRow>('users', transformDir);
    const outcomes = await loadUsers(
      {
        rows: usersFile.rows as unknown as Parameters<typeof loadUsers>[0]['rows'],
        companyId: seed.companyId,
        adminUserId: seed.adminUserId,
        dryRun,
      },
      idMap,
    );
    userOutcomes.push(...outcomes);
    const inserted = outcomes.filter(
      (o) => o.action === 'invited_new' || o.action === 'updated_public_users',
    ).length;
    loadResults.push({
      table: 'users',
      attempted: outcomes.length,
      inserted,
      conflicts: outcomes.filter((o) => o.action === 'reused_existing').length,
      dryRun,
      notes: outcomes.flatMap((o) => o.notes),
    });
    writeFileSync(join(loadDir, 'users-loaded.json'), JSON.stringify(outcomes, null, 2));
  }

  // Phase B — bulk-loadable tables (Phase 2 master data + Phase 3 op-entry chain).
  for (const table of targets) {
    if (table === 'users') continue;
    const file = readTransform<TransformedRow>(table, transformDir);
    const cfg = TABLE_CONFIGS[table];
    if (!cfg) {
      log('warn', 'no_config_skipping', { table });
      continue;
    }
    const result = await bulkLoad(
      {
        table,
        rows: file.rows,
        companyId: seed.companyId,
        adminUserId: seed.adminUserId,
        toRow: cfg.mapper,
        ...(cfg.conflictTarget !== undefined ? { conflictTarget: cfg.conflictTarget } : {}),
        ...(cfg.auditColumns !== undefined ? { auditColumns: cfg.auditColumns } : {}),
      },
      dryRun,
    );
    loadResults.push(result);
    log('info', 'table_loaded', { ...result });
  }

  if (!dryRun) {
    writeFileSync(
      idMapPath,
      JSON.stringify(
        { ...idMap, generatedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
  }

  // Phase B' — JC source FK backfill (T-029d). Runs only when the line tables
  // are in the target set; idempotent on re-runs.
  let backfill: BackfillResult | null = null;
  const backfillTrigger =
    targets.includes('sales_order_lines') || targets.includes('job_work_order_lines');
  if (backfillTrigger) {
    backfill = await runJcSourceBackfill({
      companyId: seed.companyId,
      adminUserId: seed.adminUserId,
      transformDir,
      dryRun,
    });
    log('info', 'jc_source_backfill', {
      examined: backfill.jcsExamined,
      alreadyBackfilled: backfill.jcsAlreadyBackfilled,
      backfilledSo: backfill.backfilledSo,
      backfilledJw: backfill.backfilledJw,
      unresolved: backfill.unresolved.length,
      dryRun,
    });
    writeFileSync(
      join(loadDir, '_jc_source_backfill.json'),
      JSON.stringify(backfill, null, 2),
    );
  }

  // Phase B'' — jc_op outsource FK backfill (T-035c). Runs only when the
  // procurement tables are in the target set; idempotent on re-runs.
  let outsourceBackfill: OutsourceBackfillResult | null = null;
  const outsourceTrigger =
    targets.includes('purchase_requests') || targets.includes('purchase_order_lines');
  if (outsourceTrigger) {
    outsourceBackfill = await runJcOpOutsourceBackfill({
      companyId: seed.companyId,
      adminUserId: seed.adminUserId,
      dryRun,
    });
    log('info', 'jc_op_outsource_backfill', {
      examined: outsourceBackfill.jcOpsExamined,
      alreadyBackfilled: outsourceBackfill.jcOpsAlreadyBackfilled,
      backfilledPr: outsourceBackfill.backfilledPr,
      backfilledPoLine: outsourceBackfill.backfilledPoLine,
      unresolved: outsourceBackfill.unresolved.length,
      dryRun,
    });
    writeFileSync(
      join(loadDir, '_jc_op_outsource_backfill.json'),
      JSON.stringify(outsourceBackfill, null, 2),
    );
  }

  // Phase C — count-only validation. Field-level diff comes from validate-phaseN.
  const validation: ValidationEntry[] = [];
  if (!dryRun) {
    for (const table of targets) {
      const file = readTransform<TransformedRow>(table, transformDir);
      const loadResult = loadResults.find((r) => r.table === table);
      if (!loadResult) continue;
      const entry = await validateOne({
        table,
        loadResult,
        transformRowCount: file.rowCount,
        companyId: seed.companyId,
      });
      validation.push(entry);
      log('info', 'validation', {
        table: entry.table,
        dbCount: entry.dbCount,
        transform: entry.transformRowCount,
        status: entry.status,
      });
    }
    writeFileSync(
      join(loadDir, '_validation.json'),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), companyId: seed.companyId, entries: validation },
        null,
        2,
      ),
    );
  }

  writeFileSync(
    join(loadDir, '_load_summary.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dryRun,
        targets,
        results: loadResults,
        userOutcomes: userOutcomes.length > 0 ? userOutcomes : undefined,
        jcSourceBackfill: backfill,
        jcOpOutsourceBackfill: outsourceBackfill,
      },
      null,
      2,
    ),
  );

  log('info', 'load_complete', {
    dryRun,
    tables: loadResults.length,
    totalAttempted: loadResults.reduce((s, r) => s + r.attempted, 0),
    totalInserted: loadResults.reduce((s, r) => s + r.inserted, 0),
    totalConflicts: loadResults.reduce((s, r) => s + r.conflicts, 0),
    validationFailures: validation.filter((v) => v.status === 'MISMATCH').map((v) => v.table),
  });
}

main()
  .catch((e) => {
    log('error', 'fatal', { error: (e as Error).message, stack: (e as Error).stack });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
