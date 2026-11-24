// ADR-318 guard: every list opens newest first (owner 2026-11-24: "latest no.
// on top across system", latest = Created On time). A list endpoint's default
// order is the `fallback` of sfOrderBy, so every module file that calls
// sfOrderBy must build that fallback from list-order.ts (newestFirst /
// newestFirstCols). A list that keeps its own order ON PURPOSE goes in KEEP
// with the reason — the owner said work queues and value reports stay.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, '..', 'modules');

const KEEP: Record<string, string> = {
  'machine-loading/ops-query.ts': 'work queue: high priority, then due date',
  'production-dashboard/lists.ts':
    'open JCs = priority / due-date queue (ready ops use newestFirst)',
  'osp-wip/service.ts': 'ranked by qty at vendor',
  'pending-so-value/service.ts': 'value report, biggest first',
  'stock-valuation/service.ts': 'value report, biggest first',
  'sc-dashboard/summaries.ts': 'vendor / SO summaries ranked by pending value',
  'store-inventory/list.ts': 'stock view by item',
  'store-inventory/reorder.ts': 'reorder view by item',
  'stuck-dashboard/paging.ts': 'grouped stuck view',
  'tool-issues/read.ts': 'tool holders grouped by person (issue list uses newestFirst)',
  'plans/unplanned-orders.ts': 'work queue by due date',
  'op-entry/running-ops-read.ts': 'running now, by start time',
  'op-log-viewer/service.ts': 'log by log date and time',
  'daily-task-reports/service.ts': 'report date order',
  'trash/service.ts': 'newest DELETED first',
  'saved-reports/service.ts': 'last edited first',
  'activity-log/service.ts': 'event time newest first (ts = created moment)',
  'approval-config/service.ts': 'change time newest first (ts = created moment)',
  'qc-history/register.ts': 'merged pending/completed rows, newest call / result first',
  'qc-history/service.ts': 'QC call time newest first (PENDING_ORDER)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(MODULES, p).split(sep).join('/');

describe('ADR-318 lists open newest first', () => {
  const files = walk(MODULES);

  it('every sfOrderBy list builds its default from list-order.ts', () => {
    const bad = files
      .filter((p) => !(rel(p) in KEEP))
      .filter((p) => {
        const s = readFileSync(p, 'utf8');
        return /\bsfOrderBy\s*\(/.test(s) && !/from '[./]+\/lib\/list-order'/.test(s);
      })
      .map(rel);
    expect(bad, 'default order must be newestFirst() — or add to KEEP with the reason').toEqual([]);
  });

  it('KEEP names only files that exist', () => {
    const names = new Set(files.map(rel));
    expect(Object.keys(KEEP).filter((k) => !names.has(k))).toEqual([]);
  });

  it('Home checks list newest first', () => {
    const s = readFileSync(join(MODULES, 'dashboard', 'checks', 'types.ts'), 'utf8');
    expect(s).toMatch(/sort_key DESC/);
  });
});
