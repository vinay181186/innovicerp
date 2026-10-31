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

describe('lead columns guard (ADR-261)', () => {
  it('no list column file hand-writes SO No. / Internal SO No. / POL / JWSO No. / Drawing Rev', () => {
    const offenders = columnFiles(MODULES)
      .filter((f) => HAND_WRITTEN.test(readFileSync(f, 'utf8')))
      .map((f) => relative(MODULES, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
