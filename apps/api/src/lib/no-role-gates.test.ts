// ADR-232 guard: the Access Control matrix alone decides who may write. A
// role check on a write is how "has the right, still 'Ask an admin'" happened
// (Shivani's QC Inspect, Mitul's Route Card, 2026-10-14). This test reads the
// module sources and fails if a role gate comes back.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODULES = join(__dirname, '..', 'modules');

// Old role guards — must never be called again.
const BANNED_CALL =
  /\b(requireWriteRole|requireOpEntryRole|requireQcRole|isWriteRole|requireNotViewer)\s*\(/;
// A non-admin role compared directly. `role === 'admin'` is the Super Admin
// shortcut and stays allowed.
const ROLE_COMPARE =
  /\brole\s*(===|!==)\s*'(manager|operator|qc|viewer|procurement|dispatch|design)'/;

// Reads that still look at the role, by owner decision — never a write gate.
const ALLOWED: Record<string, string> = {
  'daily-task-reports/service.ts': "who reads everyone's daily reports (no page key yet)",
  'dashboard/access.ts': 'home layout hint only',
  'dashboard/home-service.ts': 'operator home layout (cosmetic)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('ADR-232 no role gates on writes', () => {
  const files = walk(MODULES);

  it('finds the module sources', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no module calls a removed role guard', () => {
    const hits = files.filter((f) => BANNED_CALL.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(MODULES, f))).toEqual([]);
  });

  it('no module compares the derived role, except the listed reads', () => {
    const hits = files
      .filter((f) => ROLE_COMPARE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(MODULES, f).split(sep).join('/'))
      .filter((f) => !(f in ALLOWED));
    expect(hits).toEqual([]);
  });
});
