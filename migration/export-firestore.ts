// migration/export-firestore.ts
//
// T-013 — One-time Firestore export.
//
// Reads the legacy Innovic ERP Firestore (project innovic-erp-v1-77a19,
// company root collection 'innovic') and dumps each of the 67 collection
// docs to migration/export/<collection>.json. Adds _settings.json,
// _company.json, and _manifest.json with hashes + anomalies.
//
// The Firestore schema follows the JSON-blob anti-pattern: each "collection
// name" is a single document under root collection 'innovic', with a
// `records` field containing a JSON-stringified array. See legacy HTML
// lines 585-595 (COLLECTIONS array) and 839+ (_fbLoadAll read function).
//
// Usage:
//   pnpm --filter @innovic/migration export
//   pnpm --filter @innovic/migration export -- --only=salesOrders,jobCards

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Lifted verbatim from legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// lines 585-595 (the COMPANY_ID is 'innovic'; each name below is a docId
// under that root collection).
const COLLECTIONS = [
  'salesOrders',
  'jobCards',
  'jcOps',
  'opLog',
  'machines',
  'items',
  'vendors',
  'purchaseRequests',
  'purchaseOrders',
  'grn',
  'plans',
  'bomMasters',
  'routeCards',
  'costCenters',
  'userAccess',
  'dailyReports',
  'taskAllocations',
  'dashboardConfig',
  'jobWorkOrders',
  'qcProcesses',
  'reportTypes',
  'ncRegister',
  'outsourceJobs',
  'jwDCOutward',
  'jwDCInward',
  'alertConfig',
  'challans',
  'clients',
  'operators',
  'runningOps',
  'storeTransactions',
  'partyMaterials',
  'partyGrn',
  'users',
  'activityLog',
  'qcDocUploads',
  'storeIssues',
  'dispatchLog',
  'trash',
  'queueOrders',
  'opEntries',
  'assemblyTracking',
  'assemblyUnits',
  'toolIssues',
  'designTracker',
  'designTimeLog',
  'stuckThresholds',
  'qcAssignments',
  'fileRegistry',
  'designProjects',
  'designTasks',
  'designIssues',
  'designWorkLog',
  'designDCRs',
  'designDCNs',
  'ospProcessConfig',
  'ospDC',
  'servicePOs',
  'capaRecords',
  'printTemplates',
  'printTemplateRevisions',
  'schedulingHistory',
  'leads',
  'communications',
  'crmReminders',
] as const;

const COMPANY_ID = 'innovic';

interface ExportEntry {
  collection: string;
  exportedAt: string;
  sourcePath: string;
  docExists: boolean;
  updatedAt: string | null;
  recordCount: number;
  anomalies: string[];
  records: unknown[];
}

interface CollectionResult {
  collection: string;
  recordCount: number;
  docExists: boolean;
  hash: string;
  anomalies: string[];
}

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

function sha256Short(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

function tsToIso(ts: unknown): string | null {
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  if (typeof ts === 'string') return ts;
  return null;
}

async function exportCollection(
  db: Firestore,
  collection: string,
  outDir: string,
  exportedAt: string,
): Promise<CollectionResult> {
  const sourcePath = `${COMPANY_ID}/${collection}`;
  const anomalies: string[] = [];
  const docRef = db.collection(COMPANY_ID).doc(collection);
  const snap = await docRef.get();

  const entry: ExportEntry = {
    collection,
    exportedAt,
    sourcePath,
    docExists: snap.exists,
    updatedAt: null,
    recordCount: 0,
    anomalies,
    records: [],
  };

  if (!snap.exists) {
    anomalies.push('doc_missing');
  } else {
    const data = snap.data() ?? {};
    entry.updatedAt = tsToIso((data as Record<string, unknown>)['updatedAt']);
    const records = (data as Record<string, unknown>)['records'];
    if (typeof records === 'string') {
      try {
        const parsed: unknown = JSON.parse(records);
        if (Array.isArray(parsed)) {
          entry.records = parsed;
          entry.recordCount = parsed.length;
        } else {
          anomalies.push('records_not_array');
        }
      } catch (e) {
        anomalies.push(`records_parse_error: ${(e as Error).message}`);
      }
    } else if (records !== undefined) {
      anomalies.push(`records_not_string: ${typeof records}`);
    } else {
      anomalies.push('records_field_absent');
    }
  }

  const json = JSON.stringify(entry, null, 2);
  const hash = sha256Short(json);
  writeFileSync(join(outDir, `${collection}.json`), json);

  log('info', 'collection_exported', {
    collection,
    docExists: snap.exists,
    recordCount: entry.recordCount,
    hash,
    anomalies,
  });

  return { collection, recordCount: entry.recordCount, docExists: snap.exists, hash, anomalies };
}

async function exportSingleDoc(
  db: Firestore,
  rootCollection: string,
  docId: string,
  outFile: string,
  outDir: string,
  exportedAt: string,
): Promise<{ docExists: boolean; hash: string }> {
  const sourcePath = `${rootCollection}/${docId}`;
  const snap = await db.collection(rootCollection).doc(docId).get();
  const wrapped = {
    sourcePath,
    exportedAt,
    docExists: snap.exists,
    data: snap.exists ? snap.data() : null,
  };
  const json = JSON.stringify(wrapped, null, 2);
  const hash = sha256Short(json);
  writeFileSync(join(outDir, outFile), json);
  log('info', 'singleton_exported', { sourcePath, docExists: snap.exists, hash });
  return { docExists: snap.exists, hash };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
    },
  });

  const projectId = process.env['FIREBASE_PROJECT_ID'];
  const keyPath = process.env['FIREBASE_SERVICE_ACCOUNT_PATH'];

  if (!projectId || !keyPath) {
    log('error', 'missing_env', {
      needs: ['FIREBASE_PROJECT_ID', 'FIREBASE_SERVICE_ACCOUNT_PATH'],
      hint: 'Set both in .env.local at the repo root.',
    });
    process.exit(1);
  }

  let keyJson: unknown;
  try {
    keyJson = JSON.parse(readFileSync(resolve(keyPath), 'utf8'));
  } catch (e) {
    log('error', 'service_account_load_failed', {
      path: keyPath,
      error: (e as Error).message,
    });
    process.exit(1);
  }

  initializeApp({
    credential: cert(keyJson as Parameters<typeof cert>[0]),
    projectId,
  });

  const db = getFirestore();

  const filter = values.only
    ? values.only
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (filter) {
    const unknown = filter.filter((c) => !COLLECTIONS.includes(c as (typeof COLLECTIONS)[number]));
    if (unknown.length > 0) {
      log('error', 'unknown_collections_in_only_filter', { unknown });
      process.exit(1);
    }
  }

  const targets: readonly string[] = filter
    ? COLLECTIONS.filter((c) => filter.includes(c))
    : COLLECTIONS;

  const outDir = resolve(import.meta.dirname, 'export');
  mkdirSync(outDir, { recursive: true });

  const exportedAt = new Date().toISOString();
  log('info', 'export_starting', {
    projectId,
    companyId: COMPANY_ID,
    requested: targets.length,
    filter,
    outDir,
  });

  const results: CollectionResult[] = [];
  for (const collection of targets) {
    results.push(await exportCollection(db, collection, outDir, exportedAt));
  }

  // Singletons (only on a full run; --only filter skips these by design).
  let settingsHash = '';
  let companyHash = '';
  if (!filter) {
    settingsHash = (await exportSingleDoc(db, COMPANY_ID, '_settings', '_settings.json', outDir, exportedAt))
      .hash;
    companyHash = (await exportSingleDoc(db, 'companies', COMPANY_ID, '_company.json', outDir, exportedAt))
      .hash;
  }

  const manifest = {
    exportedAt,
    projectId,
    companyId: COMPANY_ID,
    filter,
    collectionsRequested: targets.length,
    collectionsExported: results.length,
    totalRecords: results.reduce((s, r) => s + r.recordCount, 0),
    docsMissing: results.filter((r) => !r.docExists).map((r) => r.collection),
    anomalies: results
      .filter((r) => r.anomalies.length > 0)
      .map((r) => ({ collection: r.collection, anomalies: r.anomalies })),
    files: results.map((r) => ({
      collection: r.collection,
      file: `${r.collection}.json`,
      hash: r.hash,
      recordCount: r.recordCount,
      docExists: r.docExists,
    })),
    singletons: filter
      ? null
      : {
          _settings: settingsHash,
          _company: companyHash,
        },
  };
  writeFileSync(join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  log('info', 'export_complete', {
    collectionsExported: results.length,
    totalRecords: manifest.totalRecords,
    docsMissing: manifest.docsMissing.length,
    anomalies: manifest.anomalies.length,
    outDir,
  });
}

main().catch((e) => {
  log('error', 'fatal', { error: (e as Error).message, stack: (e as Error).stack });
  process.exit(1);
});
