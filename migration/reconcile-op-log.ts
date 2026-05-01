// migration/reconcile-op-log.ts
//
// T-027 — Day-end reconciliation for the Phase 3 parallel run.
//
// During parallel run, operators log work in BOTH the legacy HTML and the new
// system. End of each day, we re-export legacy opLog (running export-firestore.ts
// rewrites migration/export/opLog.json) and run this script to confirm the two
// systems agree on what happened today.
//
// Match key: (jcNo, opSeq, log_date). For each key, we sum production qty
// (excluding type='start' and type='qc' on legacy; log_type='complete' only
// on new — this filters out session markers and QC inspections, matching the
// legacy line 2595 filter for "today's completed qty").
//
// Per-key categorisation:
//   MATCH         — same total qty in both
//   QTY_MISMATCH  — both exist, totals differ
//   LEGACY_ONLY   — operator logged in legacy, missed new
//   NEW_ONLY      — operator logged in new, missed legacy
//
// Exit code: 0 if all keys are MATCH, non-zero otherwise (so a CI cron can
// trigger an alert).
//
// Usage (DLP-safe):
//   cd migration
//   node --import tsx reconcile-op-log.ts                       # date = today (IST)
//   node --import tsx reconcile-op-log.ts --date=2026-05-02
//
// Or via the workspace script:
//   pnpm --filter @innovic/migration reconcile
//   pnpm --filter @innovic/migration reconcile -- --date=2026-05-02
//
// Output: console summary + migration/load-output/_reconcile_<date>.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, rawSql } from './load/db';

interface LegacyOpLogRecord {
  id: string;
  jcNo?: string;
  opSeq?: number;
  date?: string;
  qty?: number;
  type?: string;
}

interface LegacyExport {
  collection: string;
  exportedAt: string;
  records: LegacyOpLogRecord[];
}

interface NewOpLogRow {
  jc_no: string;
  op_seq: number;
  qty: number;
}

interface KeyTotals {
  qty: number;
  entries: number;
}

interface ReconcileEntry {
  jcNo: string;
  opSeq: number;
  legacy: KeyTotals | null;
  newSys: KeyTotals | null;
  status: 'MATCH' | 'QTY_MISMATCH' | 'LEGACY_ONLY' | 'NEW_ONLY';
  delta: number; // newSys.qty - legacy.qty (0 for MATCH; non-zero otherwise)
}

interface ReconcileReport {
  generatedAt: string;
  date: string;
  legacyExportedAt: string;
  companyId: string;
  totals: {
    keys: number;
    match: number;
    qtyMismatch: number;
    legacyOnly: number;
    newOnly: number;
    legacyTotalQty: number;
    newTotalQty: number;
  };
  entries: ReconcileEntry[];
  overallStatus: 'PASS' | 'FAIL';
}

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(ctx ?? {}) }));
}

// Today's date in IST as YYYY-MM-DD. Per CLAUDE.md §1: "All timestamps stored
// in UTC, displayed in IST".
function todayInIst(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function key(jcNo: string, opSeq: number): string {
  return `${jcNo}::${opSeq}`;
}

function readLegacyExport(exportDir: string): LegacyExport {
  const path = join(exportDir, 'opLog.json');
  return JSON.parse(readFileSync(path, 'utf8')) as LegacyExport;
}

function rollupLegacy(records: LegacyOpLogRecord[], date: string): Map<string, KeyTotals> {
  const map = new Map<string, KeyTotals>();
  for (const r of records) {
    if (r.date !== date) continue;
    if (r.type === 'start' || r.type === 'qc') continue; // markers, not work
    if (!r.jcNo || typeof r.opSeq !== 'number') continue;
    const k = key(r.jcNo, r.opSeq);
    const cur = map.get(k) ?? { qty: 0, entries: 0 };
    cur.qty += typeof r.qty === 'number' ? r.qty : 0;
    cur.entries += 1;
    map.set(k, cur);
  }
  return map;
}

async function rollupNew(date: string, companyId: string): Promise<Map<string, KeyTotals>> {
  const rows = (await rawSql<NewOpLogRow[]>`
    SELECT
      jc.code AS jc_no,
      o.op_seq,
      l.qty
    FROM public.op_log l
    JOIN public.jc_ops o ON o.id = l.jc_op_id
    JOIN public.job_cards jc ON jc.id = o.job_card_id
    WHERE l.company_id = ${companyId}::uuid
      AND l.log_date = ${date}::date
      AND l.log_type = 'complete'
  `) as unknown as NewOpLogRow[];
  const map = new Map<string, KeyTotals>();
  for (const r of rows) {
    const k = key(r.jc_no, r.op_seq);
    const cur = map.get(k) ?? { qty: 0, entries: 0 };
    cur.qty += r.qty;
    cur.entries += 1;
    map.set(k, cur);
  }
  return map;
}

function reconcile(
  legacy: Map<string, KeyTotals>,
  newSys: Map<string, KeyTotals>,
): ReconcileEntry[] {
  const allKeys = new Set<string>([...legacy.keys(), ...newSys.keys()]);
  const entries: ReconcileEntry[] = [];
  for (const k of allKeys) {
    const [jcNo, opSeqStr] = k.split('::');
    const opSeq = Number(opSeqStr);
    const l = legacy.get(k) ?? null;
    const n = newSys.get(k) ?? null;
    let status: ReconcileEntry['status'];
    let delta: number;
    if (l && n) {
      if (l.qty === n.qty) {
        status = 'MATCH';
        delta = 0;
      } else {
        status = 'QTY_MISMATCH';
        delta = n.qty - l.qty;
      }
    } else if (l && !n) {
      status = 'LEGACY_ONLY';
      delta = -l.qty;
    } else {
      status = 'NEW_ONLY';
      delta = n?.qty ?? 0;
    }
    entries.push({
      jcNo: jcNo ?? '',
      opSeq,
      legacy: l,
      newSys: n,
      status,
      delta,
    });
  }
  // Stable sort: status first (failures up top), then jcNo, then opSeq.
  const order: Record<ReconcileEntry['status'], number> = {
    QTY_MISMATCH: 0,
    LEGACY_ONLY: 1,
    NEW_ONLY: 2,
    MATCH: 3,
  };
  return entries.sort((a, b) => {
    const so = order[a.status] - order[b.status];
    if (so !== 0) return so;
    const jo = a.jcNo.localeCompare(b.jcNo);
    if (jo !== 0) return jo;
    return a.opSeq - b.opSeq;
  });
}

async function resolveCompanyId(): Promise<string> {
  const company = await rawSql<Array<{ id: string }>>`
    SELECT id FROM public.companies WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `;
  const id = company[0]?.id;
  if (!id) throw new Error('No company in public.companies');
  return id;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { date: { type: 'string' } },
  });
  const date = values.date ?? todayInIst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    log('error', 'invalid_date_format', { date, expected: 'YYYY-MM-DD' });
    process.exit(2);
  }

  const repoRoot = resolve(import.meta.dirname, '..');
  const exportDir = join(repoRoot, 'migration', 'export');
  const outDir = join(repoRoot, 'migration', 'load-output');
  mkdirSync(outDir, { recursive: true });

  log('info', 'reconcile_starting', { date });

  const companyId = await resolveCompanyId();
  log('info', 'company_resolved', { companyId });

  const legacyExport = readLegacyExport(exportDir);
  log('info', 'legacy_loaded', {
    exportedAt: legacyExport.exportedAt,
    totalRecords: legacyExport.records.length,
  });

  const legacyRollup = rollupLegacy(legacyExport.records, date);
  const newRollup = await rollupNew(date, companyId);
  log('info', 'rolled_up', {
    legacyKeys: legacyRollup.size,
    newKeys: newRollup.size,
  });

  const entries = reconcile(legacyRollup, newRollup);
  const totals = {
    keys: entries.length,
    match: entries.filter((e) => e.status === 'MATCH').length,
    qtyMismatch: entries.filter((e) => e.status === 'QTY_MISMATCH').length,
    legacyOnly: entries.filter((e) => e.status === 'LEGACY_ONLY').length,
    newOnly: entries.filter((e) => e.status === 'NEW_ONLY').length,
    legacyTotalQty: [...legacyRollup.values()].reduce((s, v) => s + v.qty, 0),
    newTotalQty: [...newRollup.values()].reduce((s, v) => s + v.qty, 0),
  };
  const overallStatus: 'PASS' | 'FAIL' =
    totals.qtyMismatch === 0 && totals.legacyOnly === 0 && totals.newOnly === 0 ? 'PASS' : 'FAIL';

  const report: ReconcileReport = {
    generatedAt: new Date().toISOString(),
    date,
    legacyExportedAt: legacyExport.exportedAt,
    companyId,
    totals,
    entries,
    overallStatus,
  };

  const outPath = join(outDir, `_reconcile_${date}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  log('info', 'reconcile_complete', {
    date,
    overallStatus,
    totals,
    outPath,
  });

  // Print a human-readable failure list to stdout (so it shows up in cron mail).
  if (overallStatus === 'FAIL') {
    console.log('\n--- Divergences ---');
    for (const e of entries) {
      if (e.status === 'MATCH') continue;
      console.log(
        `  ${e.status.padEnd(13)} ${e.jcNo} op${e.opSeq}  legacy=${e.legacy?.qty ?? '-'}  new=${e.newSys?.qty ?? '-'}  delta=${e.delta}`,
      );
    }
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    log('error', 'fatal', { error: (e as Error).message, stack: (e as Error).stack });
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeDb();
  });
