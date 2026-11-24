// ADR-310 guard — every list has ONE Export. A file under modules/ that draws
// <ListHeader must pass `exportSpec` (the shared button), or be one of the
// lists that still carry their own hand-made Export, or sit on ALLOW with a
// reason. Batches A/B/C of ADR-310 switch lists on and DELETE their ALLOW
// entry; a stale entry (file gone, or already passing exportSpec) fails too.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, '..', '..', 'modules');

/** Lists with their own Export button (they write the EXPORT log themselves). */
const HAND_MADE = new Set([
  'sales-orders/routes/list.tsx',
  'production-orders/routes/list.tsx',
  'customer-dispatches/routes/list.tsx',
  'op-log/routes/list.tsx',
  'tpi/components/tpi-view.tsx',
  'qc-call-register/components/qc-call-register-header.tsx',
  'qc-history/routes/index.tsx',
]);

const NOT_A_LIST = 'permanent: not a row list';

const ALLOW: Record<string, string> = {
  // ── permanent exclusions ──
  'alerts/routes/dashboard.tsx': `${NOT_A_LIST} — alerts dashboard (tiles)`,
  'alerts/routes/drill.tsx': `${NOT_A_LIST} — alert drill-down from the dashboard`,
  'production-dashboard/routes/index.tsx': `${NOT_A_LIST} — production dashboard`,
  'stuck-dashboard/routes/page.tsx': `${NOT_A_LIST} — stuck-work dashboard`,
  'sc-dashboard/routes/page.tsx': `${NOT_A_LIST} — subcontract dashboard`,
  'qc-command/routes/index.tsx': `${NOT_A_LIST} — QC command centre`,
  'production-schedule/routes/list.tsx': `${NOT_A_LIST} — Gantt schedule`,
  'op-entry/routes/running.tsx': `${NOT_A_LIST} — running-operations board`,
  'qc-documents/components/dossier-view.tsx': 'permanent: QC Dossier downloads a ZIP',
  'trash/routes/list.tsx': 'permanent: Trash holds deleted records',
  'approvals/components/approvals-list.tsx': 'permanent: Approvals waiting list',
  'ui-kit/routes/page.tsx': 'permanent: /__ui-kit preview page',
  'job-cards/components/jc-list-filters.tsx':
    'permanent: filter slot only (comment names <ListHeader>); the JC list Export is in job-cards/routes/list.tsx',
  // ── still open ──
  'design-work-log/routes/list.tsx':
    'ADR-310 open: five tabs (My Log, Daily, Weekly, Project Hours, Alerts), each its own table — needs a per-tab Export',
};

function tsxFiles(dir: string, ext = /\.tsx$/): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p, ext));
    else if (ext.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string): string => relative(MODULES, p).replace(/\\/g, '/');
const FILES = new Map(tsxFiles(MODULES).map((p) => [rel(p), readFileSync(p, 'utf8')]));
const usesHeader = (src: string): boolean => /<ListHeader\b/.test(src);
const usesSpec = (src: string): boolean => /\bexportSpec=\{/.test(src);

describe('ADR-310 — one Export on every list', () => {
  it('every <ListHeader passes exportSpec, has its own Export, or is allowed', () => {
    const missing = [...FILES]
      .filter(([, src]) => usesHeader(src) && !usesSpec(src))
      .map(([f]) => f)
      .filter((f) => !HAND_MADE.has(f) && !(f in ALLOW));
    expect(missing, 'pass exportSpec to ListHeader (ADR-310)').toEqual([]);
  });

  it('no list has both the shared Export and an ALLOW / hand-made entry', () => {
    const both = [...FILES]
      .filter(([f, src]) => usesSpec(src) && (HAND_MADE.has(f) || f in ALLOW))
      .map(([f]) => f);
    expect(both, 'delete the ALLOW / HAND_MADE entry of a switched-on list').toEqual([]);
  });

  it('every ALLOW / hand-made entry is a file that still draws <ListHeader', () => {
    const stale = [...HAND_MADE, ...Object.keys(ALLOW)].filter(
      (f) => !usesHeader(FILES.get(f) ?? ''),
    );
    expect(stale, 'remove stale entries').toEqual([]);
  });

  // Owner 23-11-2026 (Job Queue lost its machine): a group heading is not a
  // column, so a list that draws one must hand its facts to the Export.
  it('a list with group headings exports their facts (groupColumns)', () => {
    const missing = [...FILES]
      .filter(([, src]) => /\bgroupRow=\{/.test(src) && usesSpec(src))
      .map(([f]) => f)
      .filter((f) => {
        const mod = join(MODULES, f.split('/')[0] ?? '');
        const files = tsxFiles(mod, /\.tsx?$/);
        return !files.some((p) => /\bgroupColumns:/.test(readFileSync(p, 'utf8')));
      });
    expect(missing, 'give exportSpec groupColumns for the group heading').toEqual([]);
  });

  it('the pilot (JWSO Master) is on the shared Export', () => {
    expect(usesSpec(FILES.get('job-work-orders/routes/list.tsx') ?? '')).toBe(true);
  });
});
