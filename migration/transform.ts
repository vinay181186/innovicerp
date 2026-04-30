// migration/transform.ts
//
// T-014 — Per-collection transform orchestrator.
//
// Reads migration/export/<collection>.json (output of T-013) and runs the
// matching per-collection transform from migration/transforms/<name>.ts,
// writing results to migration/transform/<table>.json plus a shared
// _id_map.json and _anomalies.json for downstream T-015 (load).
//
// Scope today: master-data collections WITH existing Postgres tables
// (users, items). The 4 master-data collections without tables yet
// (clients, vendors, machines, operators) are stubbed and will be wired
// when their schemas land in T-017–T-021.
//
// Usage:
//   pnpm --filter @innovic/migration transform
//   pnpm --filter @innovic/migration transform -- --only=items
//
// Or, if DLP intercepts the pnpm wrapper on this dev box (see migration/README):
//   node --import tsx transform.ts [--only=...]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { transformItems } from './transforms/items';
import type { Anomaly, IdMap, TransformResult } from './transforms/types';
import { transformUsers } from './transforms/users';

const TRANSFORMS = {
  users: transformUsers,
  items: transformItems,
  // Stubs for tables that don't exist yet — implemented in T-017–T-021.
  clients: () => {
    throw new Error('clients schema not yet defined; implement under T-017');
  },
  vendors: () => {
    throw new Error('vendors schema not yet defined; implement under T-018');
  },
  machines: () => {
    throw new Error('machines schema not yet defined; implement under T-020');
  },
  operators: () => {
    throw new Error('operators schema not yet defined; implement under T-021');
  },
} as const;

type CollectionName = keyof typeof TRANSFORMS;
const ALL_COLLECTIONS = Object.keys(TRANSFORMS) as CollectionName[];
// Collections actually wired today.
const WIRED_COLLECTIONS: CollectionName[] = ['users', 'items'];

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

function readExport(collection: CollectionName, exportDir: string): unknown[] {
  const path = join(exportDir, `${collection}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { records?: unknown[] };
  return raw.records ?? [];
}

interface PerCollectionSummary {
  collection: string;
  table: string;
  inputCount: number;
  rowCount: number;
  anomalyCount: number;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
    },
  });

  const repoRoot = resolve(import.meta.dirname, '..');
  const exportDir = join(repoRoot, 'migration', 'export');
  const transformDir = join(repoRoot, 'migration', 'transform');
  mkdirSync(transformDir, { recursive: true });

  const filter = values.only
    ? values.only
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (filter) {
    const unknown = filter.filter((c) => !ALL_COLLECTIONS.includes(c as CollectionName));
    if (unknown.length > 0) {
      log('error', 'unknown_collections', { unknown });
      process.exit(1);
    }
  }

  const targets: CollectionName[] = filter
    ? (filter as CollectionName[])
    : WIRED_COLLECTIONS;

  log('info', 'transform_starting', {
    requested: targets.length,
    filter,
    exportDir,
    transformDir,
  });

  const idMap: IdMap = {};
  const anomaliesByTable: Record<string, Anomaly[]> = {};
  const summaries: PerCollectionSummary[] = [];

  for (const collection of targets) {
    if (!WIRED_COLLECTIONS.includes(collection)) {
      // Trigger the stub error explicitly so the caller sees why nothing happened.
      try {
        TRANSFORMS[collection]([] as never);
      } catch (e) {
        log('warn', 'collection_not_wired', {
          collection,
          reason: (e as Error).message,
        });
      }
      continue;
    }

    const records = readExport(collection, exportDir);
    log('info', 'transforming', { collection, inputCount: records.length });

    const fn = TRANSFORMS[collection] as (rs: unknown[]) => TransformResult<unknown>;
    const result = fn(records);

    const out = {
      table: result.table,
      sourceCollection: result.sourceCollection,
      transformedAt: result.transformedAt,
      rowCount: result.rows.length,
      anomalyCount: result.anomalies.length,
      rows: result.rows,
    };
    writeFileSync(join(transformDir, `${result.table}.json`), JSON.stringify(out, null, 2));

    idMap[result.table] = {};
    for (const row of result.rows as Array<{ _legacyId: string; id?: string }>) {
      idMap[result.table]![row._legacyId] = row.id ?? null;
    }

    if (result.anomalies.length > 0) {
      anomaliesByTable[result.table] = result.anomalies;
    }

    summaries.push({
      collection,
      table: result.table,
      inputCount: records.length,
      rowCount: result.rows.length,
      anomalyCount: result.anomalies.length,
    });

    log('info', 'collection_transformed', {
      collection,
      table: result.table,
      inputCount: records.length,
      rowCount: result.rows.length,
      anomalies: result.anomalies.length,
    });
  }

  writeFileSync(
    join(transformDir, '_id_map.json'),
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        note: 'null values are unresolved; T-015 (load) fills users via Supabase Auth.',
        ...idMap,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(transformDir, '_anomalies.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...anomaliesByTable,
      },
      null,
      2,
    ),
  );

  const totalAnomalies = summaries.reduce((s, x) => s + x.anomalyCount, 0);
  const totalRows = summaries.reduce((s, x) => s + x.rowCount, 0);

  log('info', 'transform_complete', {
    tables: summaries.length,
    totalRows,
    totalAnomalies,
    summaries,
    transformDir,
  });
}

main().catch((e) => {
  log('error', 'fatal', { error: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
