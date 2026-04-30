// migration/load.ts
//
// T-015 — Bulk-load Phase 2 master data into Supabase Postgres.
//
// Reads migration/transform/<table>.json (output of T-014), resolves the
// runtime context (seed company id + admin user id), invokes the users
// loader (special two-phase) and the generic bulk loader for the other 5
// tables, then validates counts/samples and writes a load report.
//
// Usage:
//   pnpm --filter @innovic/migration load
//   pnpm --filter @innovic/migration load -- --only=items
//   pnpm --filter @innovic/migration load -- --dry-run
//
// Or, if DLP intercepts the pnpm wrapper on this dev box:
//   cd migration
//   FIREBASE_*= ... DATABASE_URL=... SUPABASE_*=... node --import tsx load.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { bulkLoad, type BulkLoadConfig } from './load/bulk-loader';
import { rawSql, closeDb } from './load/db';
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

const ALL_TABLES = ['users', 'clients', 'vendors', 'items', 'machines', 'operators'] as const;
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

// Per-table row mappers — strip transform-only fields and rename camelCase
// to snake_case columns.

const ITEM_MAPPER: BulkLoadConfig<TransformedRow>['toRow'] = (row) => ({
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

const CLIENT_MAPPER: BulkLoadConfig<TransformedRow>['toRow'] = (row) => ({
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

const VENDOR_MAPPER: BulkLoadConfig<TransformedRow>['toRow'] = (row) => ({
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

const MACHINE_MAPPER: BulkLoadConfig<TransformedRow>['toRow'] = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  machine_type: row['machineType'],
  capacity_per_shift: row['capacityPerShift'],
  shifts_per_day: row['shiftsPerDay'],
  status: row['status'],
});

const OPERATOR_MAPPER: BulkLoadConfig<TransformedRow>['toRow'] = (row) => ({
  id: row['id'],
  code: row['code'],
  name: row['name'],
  department: row['department'],
  skills: row['skills'],
  is_active: row['isActive'],
  user_id: row['userId'],
});

const MAPPERS: Record<
  Exclude<TableName, 'users'>,
  BulkLoadConfig<TransformedRow>['toRow']
> = {
  items: ITEM_MAPPER,
  clients: CLIENT_MAPPER,
  vendors: VENDOR_MAPPER,
  machines: MACHINE_MAPPER,
  operators: OPERATOR_MAPPER,
};

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

  // Resolve runtime context.
  const seed = await resolveSeedContext();
  log('info', 'seed_context_resolved', { companyId: seed.companyId, adminUserId: seed.adminUserId });

  // Load id_map (carry forward from transform; we'll mutate users).
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

  // Phase B — bulk-loadable master data.
  for (const table of targets) {
    if (table === 'users') continue;
    const file = readTransform<TransformedRow>(table, transformDir);
    const result = await bulkLoad(
      {
        table,
        rows: file.rows,
        companyId: seed.companyId,
        adminUserId: seed.adminUserId,
        toRow: MAPPERS[table],
      },
      dryRun,
    );
    loadResults.push(result);
    log('info', 'table_loaded', { ...result });
  }

  // Persist updated id_map (users now have UUIDs).
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

  // Phase C — validation.
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
