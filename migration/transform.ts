// migration/transform.ts
//
// T-014 (Phase 2) + T-024c (Phase 3) — Per-collection transform orchestrator.
//
// Reads migration/export/<collection>.json (output of T-013) and runs the
// matching per-collection transform from migration/transforms/<name>.ts,
// writing results to migration/transform/<table>.json plus a shared
// _id_map.json and _anomalies.json for downstream T-015 / T-024d (load).
//
// Phase 3 transforms need code/composite-key lookups built incrementally as
// transforms run; the orchestrator updates a shared LookupRegistry after each
// transform and pre-loads from on-disk Phase 2 results when running with
// --only.
//
// Usage:
//   pnpm --filter @innovic/migration transform
//   pnpm --filter @innovic/migration transform -- --only=items
//   pnpm --filter @innovic/migration transform -- --only=routeCards,jobCards,jcOps,opLog,runningOps
//
// Or, if DLP intercepts the pnpm wrapper on this dev box (see migration/README):
//   node --import tsx transform.ts [--only=...]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { transformClients } from './transforms/clients';
import { transformItems } from './transforms/items';
import { transformJcOps } from './transforms/jc-ops';
import { transformJobCards } from './transforms/job-cards';
import { transformMachines } from './transforms/machines';
import { transformOperators } from './transforms/operators';
import { transformOpLog } from './transforms/op-log';
import { transformRouteCards } from './transforms/route-cards';
import { transformRunningOps } from './transforms/running-ops';
import {
  emptyRegistry,
  ensureLookup,
  loadCodeLookupFromDisk,
  loadNameLookupFromDisk,
} from './transforms/lookups';
import type { Anomaly, TransformContext, TransformResult } from './transforms/types';
import { transformUsers } from './transforms/users';
import { transformVendors } from './transforms/vendors';

// Each transform produces one or more TransformResults. Phase 2 = single,
// Phase 3 routeCards = three (route_cards + route_card_ops + route_card_revisions).
type TransformFn = (
  records: unknown[],
  ctx: TransformContext,
) => TransformResult<unknown> | TransformResult<unknown>[];

const TRANSFORMS: Record<string, TransformFn> = {
  // Phase 2 (T-014) — master data
  users: (rs) => transformUsers(rs as Parameters<typeof transformUsers>[0]),
  clients: (rs) => transformClients(rs as Parameters<typeof transformClients>[0]),
  vendors: (rs) => transformVendors(rs as Parameters<typeof transformVendors>[0]),
  items: (rs) => transformItems(rs as Parameters<typeof transformItems>[0]),
  machines: (rs) => transformMachines(rs as Parameters<typeof transformMachines>[0]),
  operators: (rs) => transformOperators(rs as Parameters<typeof transformOperators>[0]),
  // Phase 3 (T-024c) — op-entry chain
  routeCards: (rs, ctx) =>
    transformRouteCards(rs as Parameters<typeof transformRouteCards>[0], ctx),
  jobCards: (rs, ctx) => transformJobCards(rs as Parameters<typeof transformJobCards>[0], ctx),
  jcOps: (rs, ctx) => transformJcOps(rs as Parameters<typeof transformJcOps>[0], ctx),
  opLog: (rs, ctx) => transformOpLog(rs as Parameters<typeof transformOpLog>[0], ctx),
  runningOps: (rs, ctx) =>
    transformRunningOps(rs as Parameters<typeof transformRunningOps>[0], ctx),
};

type CollectionName = keyof typeof TRANSFORMS;
const ALL_COLLECTIONS = Object.keys(TRANSFORMS) as CollectionName[];

// FK-dependency order: Phase 2 first (no intra-Phase deps), then Phase 3 in
// the order route_cards/job_cards (siblings, both depend on items) →
// jc_ops (depends on job_cards + machines + vendors) → op_log (depends on
// jc_ops + operators) → running_ops (depends on jc_ops + machines + operators).
const WIRED_COLLECTIONS: CollectionName[] = [
  'users',
  'clients',
  'vendors',
  'items',
  'machines',
  'operators',
  'routeCards',
  'jobCards',
  'jcOps',
  'opLog',
  'runningOps',
];

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

function readExport(collection: CollectionName, exportDir: string): unknown[] {
  const path = join(exportDir, `${collection}.json`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { records?: unknown[] };
  return raw.records ?? [];
}

interface PerTableSummary {
  collection: string;
  table: string;
  inputCount: number;
  rowCount: number;
  anomalyCount: number;
}

// Update lookup registry from a transform result. Knows which tables produce
// which kinds of lookups (byCode for masters, byCompositeKey for jc_ops,
// byName for operators).
function updateLookupsFromResult(
  ctx: TransformContext,
  result: TransformResult<unknown>,
): void {
  const rows = result.rows as Array<Record<string, unknown>>;

  // byCode lookups for master tables and Phase 3 parent tables
  if (['items', 'machines', 'vendors', 'clients', 'operators', 'route_cards'].includes(result.table)) {
    const m = new Map<string, string>();
    for (const r of rows) {
      const code = r['code'];
      const id = r['id'];
      if (typeof code === 'string' && typeof id === 'string') m.set(code, id);
    }
    ctx.lookups.byCode[result.table] = m;
  }

  // byCode for job_cards is keyed by `code` (which holds jcNo)
  if (result.table === 'job_cards') {
    const m = new Map<string, string>();
    for (const r of rows) {
      const code = r['code'];
      const id = r['id'];
      if (typeof code === 'string' && typeof id === 'string') m.set(code, id);
    }
    ctx.lookups.byCode['job_cards'] = m;
  }

  // byCompositeKey for jc_ops: `${jcNo}::${opSeq}`
  if (result.table === 'jc_ops') {
    const m = new Map<string, string>();
    for (const r of rows) {
      const jcNo = r['_legacyJcNo'];
      const opSeq = r['opSeq'];
      const id = r['id'];
      if (typeof jcNo === 'string' && typeof opSeq === 'number' && typeof id === 'string') {
        m.set(`${jcNo}::${opSeq}`, id);
      }
    }
    ctx.lookups.byCompositeKey['jc_ops'] = m;
  }

  // byName for operators (case-insensitive): name → id
  if (result.table === 'operators') {
    const m = new Map<string, string>();
    for (const r of rows) {
      const name = r['name'];
      const id = r['id'];
      if (typeof name === 'string' && typeof id === 'string') {
        m.set(name.trim().toLowerCase(), id);
      }
    }
    ctx.lookups.byName['operators'] = m;
  }
}

// Pre-load lookups from on-disk transform output for tables not in this run.
// Lets Phase 3 transforms work even when only a subset is requested.
function prefetchDependencyLookups(
  ctx: TransformContext,
  targets: CollectionName[],
  transformDir: string,
): void {
  const need = (table: string, codeField: string): void => {
    ensureLookup(ctx.lookups, 'byCode', table, () =>
      loadCodeLookupFromDisk(transformDir, table, codeField),
    );
  };
  const needName = (table: string, nameField: string): void => {
    ensureLookup(ctx.lookups, 'byName', table, () =>
      loadNameLookupFromDisk(transformDir, table, nameField),
    );
  };

  if (targets.includes('routeCards')) need('items', 'code');
  if (targets.includes('jobCards')) need('items', 'code');
  if (targets.includes('jcOps')) {
    need('job_cards', 'code');
    need('machines', 'code');
    need('vendors', 'code');
  }
  if (targets.includes('opLog')) {
    need('operators', 'code');
    needName('operators', 'name');
    // jc_ops composite-key lookup must come from in-memory run; can't reload
    // from disk easily because it needs `_legacyJcNo` from each row. If
    // running opLog standalone, ensure jcOps is also in the run.
  }
  if (targets.includes('runningOps')) {
    need('machines', 'code');
    need('operators', 'code');
    needName('operators', 'name');
  }
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

  const ctx: TransformContext = {
    idMap: {},
    lookups: emptyRegistry(),
  };

  prefetchDependencyLookups(ctx, targets, transformDir);

  log('info', 'transform_starting', {
    requested: targets.length,
    filter,
    exportDir,
    transformDir,
  });

  const anomaliesByTable: Record<string, Anomaly[]> = {};
  const summaries: PerTableSummary[] = [];

  for (const collection of targets) {
    const records = readExport(collection, exportDir);
    log('info', 'transforming', { collection, inputCount: records.length });

    const fn = TRANSFORMS[collection];
    if (!fn) continue;
    const raw = fn(records, ctx);
    const results = Array.isArray(raw) ? raw : [raw];

    for (const result of results) {
      const out = {
        table: result.table,
        sourceCollection: result.sourceCollection,
        transformedAt: result.transformedAt,
        rowCount: result.rows.length,
        anomalyCount: result.anomalies.length,
        rows: result.rows,
      };
      writeFileSync(join(transformDir, `${result.table}.json`), JSON.stringify(out, null, 2));

      ctx.idMap[result.table] = {};
      for (const row of result.rows as Array<{ _legacyId: string; id?: string }>) {
        ctx.idMap[result.table]![row._legacyId] = row.id ?? null;
      }

      if (result.anomalies.length > 0) {
        anomaliesByTable[result.table] = result.anomalies;
      }

      updateLookupsFromResult(ctx, result);

      summaries.push({
        collection,
        table: result.table,
        inputCount: records.length,
        rowCount: result.rows.length,
        anomalyCount: result.anomalies.length,
      });

      log('info', 'table_transformed', {
        collection,
        table: result.table,
        inputCount: records.length,
        rowCount: result.rows.length,
        anomalies: result.anomalies.length,
      });
    }
  }

  writeFileSync(
    join(transformDir, '_id_map.json'),
    JSON.stringify(
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        note: 'null values are unresolved; T-015 (load) fills users via Supabase Auth.',
        ...ctx.idMap,
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
