// ADR-261 guard — the SO No. / Internal SO No. / POL list columns are built ONLY
// by `leadColumns()` (ui/data/lead-columns.tsx), so every SO-linked list opens
// with the same fixed six. A column array that hand-writes one of these headers
// fails this test. Detail panels, forms and prints (not DataTable columns) are
// not scanned: only files whose name says they hold list columns.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, '..', '..', 'modules');

/** Hand-written lead headers inside a column object: `header: 'SO No.'` etc. */
const HAND_WRITTEN = /header:\s*['"](SO No\.|Internal SO No\.|POL|JWSO No\.|Drawing Rev)['"]/;

function columnFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...columnFiles(p));
    else if (/columns?\.tsx$|Tab\.tsx$/i.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** Lists whose row IS the SO / JWSO (or that have no own number): SO No. is
 *  the own number, so no `doc:` column goes in front of it. */
const ROW_IS_ORDER = new Set([
  'sales-orders/components/so-list-columns.tsx',
  'sales-orders/components/so-line-columns.tsx',
  'job-work-orders/components/jwso-list-columns.tsx',
  'so-overview/components/so-overview-columns.tsx',
  'so-costing/routes/list.tsx',
  'so-cycle-time/lib/columns.tsx',
  'pending-so-value/components/psv-columns.tsx',
  'so-planning/components/order-list-columns.tsx',
  'so-planning/components/planning-line-columns.tsx',
  'so-planning/components/line-search-columns.tsx',
  'plans/components/needs-planning-table.tsx',
  'stuck-dashboard/routes/page.tsx',
  'store-inventory/components/reservation-drilldown.tsx',
  'qc-documents/components/so-status-columns.tsx',
  'qc-documents/components/register-columns.tsx',
  'item-revisions/components/fix-list-columns.tsx',
  'sc-dashboard/components/vendor-so-columns.tsx',
]);

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allFiles(p));
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('own document number first (ADR-261, owner 31-Oct)', () => {
  it('every leadColumns list passes its own number as `doc:` unless the row is the order', () => {
    const missing = allFiles(MODULES)
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return /leadColumns</.test(src) && !/\bdoc:/.test(src);
      })
      .map((f) => relative(MODULES, f).replace(/\\/g, '/'))
      .filter((f) => !ROW_IS_ORDER.has(f));
    expect(missing).toEqual([]);
  });
});

describe('lead columns guard (ADR-261)', () => {
  it('no list column file hand-writes SO No. / Internal SO No. / POL / JWSO No. / Drawing Rev', () => {
    const offenders = columnFiles(MODULES)
      .filter((f) => HAND_WRITTEN.test(readFileSync(f, 'utf8')))
      .map((f) => relative(MODULES, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
