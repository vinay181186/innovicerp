// @vitest-environment node
// CLAUDE.md §22 — no screen ships without a refresh plan, and no refresh names
// a list that does not exist. Reads the source files, so it needs no browser
// and no database; runs with `pnpm --filter web test` (and in CI).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { REFRESH_POLICY, ROOTS_DEFINED_BY_HELPERS } from './refresh-policy';

// table-keys imports module api files, which import the API client and
// validate env at load. Neither is used here.
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const { LIVE_TABLE_KEYS } = await import('./table-keys');

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** A call that USES a key (refresh / remove / write cache) rather than defines one. */
const USE_OBJECT =
  /\b(?:invalidateQueries|refetchQueries|removeQueries|resetQueries|cancelQueries|setQueriesData|getQueriesData|isFetching)\(\s*\{\s*queryKey:\s*\[\s*'([^']+)'/g;
const USE_ARRAY = /\b(?:setQueryData|getQueryData)\(\s*\[\s*'([^']+)'/g;
/** A list of keys refreshed in a loop: `for (const queryKey of [ … ])`. */
const KEY_LOOP = /for\s*\(\s*const\s+\w+\s+of\s+\[([\s\S]*?)\]\s*\)/g;
const LITERAL_IN_LIST = /(?:^|[\s,])\[\s*'([^']+)'/g;
const FACTORY_ROOT = /\ball:\s*\[\s*'([^']+)'/g;
const QUERY_KEY = /queryKey:\s*\[\s*'([^']+)'/g;

interface Scan {
  /** root → files that define a query under it */
  defined: Map<string, Set<string>>;
  /** literal roots used by refresh / cache calls (and refresh loops), with the file */
  used: Array<{ root: string; file: string }>;
  /** modules (or lone files) whose code sets refetchInterval */
  polls: Set<string>;
}

/** `modules/<name>/…` → `modules/<name>`; any other file stands alone. A
 *  module may poll in its route (job-cards list) or in its api.ts. */
function moduleOf(file: string): string {
  const m = /^modules\/[^/]+/.exec(file);
  return m ? m[0] : file;
}

function scan(): Scan {
  const defined = new Map<string, Set<string>>();
  const used: Scan['used'] = [];
  const polls = new Set<string>();
  const define = (root: string, file: string): void => {
    const set = defined.get(root) ?? new Set<string>();
    set.add(file);
    defined.set(root, set);
  };
  for (const path of sourceFiles(SRC)) {
    if (path.includes(`${sep}lib${sep}live-updates${sep}`)) continue;
    const text = readFileSync(path, 'utf8');
    const file = relative(SRC, path).split(sep).join('/');
    // Whole-line comments only (a `'image/*'` string must not open a comment).
    const code = text.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '');
    if (/\brefetchInterval\s*:/.test(code)) polls.add(moduleOf(file));
    const useRanges: Array<[number, number]> = [];
    for (const m of text.matchAll(USE_OBJECT)) {
      useRanges.push([m.index, m.index + m[0].length]);
      used.push({ root: m[1] as string, file });
    }
    for (const m of text.matchAll(USE_ARRAY)) used.push({ root: m[1] as string, file });
    for (const loop of text.matchAll(KEY_LOOP)) {
      for (const m of (loop[1] as string).matchAll(LITERAL_IN_LIST)) {
        used.push({ root: m[1] as string, file });
      }
    }
    for (const m of text.matchAll(FACTORY_ROOT)) define(m[1] as string, file);
    for (const m of text.matchAll(QUERY_KEY)) {
      if (useRanges.some(([a, b]) => m.index >= a && m.index < b)) continue;
      define(m[1] as string, file);
    }
  }
  for (const root of ROOTS_DEFINED_BY_HELPERS) define(root, '(helper)');
  return { defined, used, polls };
}

const { defined, used, polls } = scan();
const liveRoots = new Set(
  Object.values(LIVE_TABLE_KEYS).flatMap((keys) => keys.map((k) => String(k[0]))),
);

describe('refresh coverage (CLAUDE.md §22)', () => {
  it('finds the key factories (scan sanity)', () => {
    expect(defined.size).toBeGreaterThan(80);
    expect(defined.has('job-cards')).toBe(true);
  });

  it('every refresh / cache call names a list that exists', () => {
    const unknown = used.filter((u) => !defined.has(u.root)).map((u) => `${u.file}: '${u.root}'`);
    expect(unknown, 'literal queryKey naming no real list — import the module key factory').toEqual(
      [],
    );
  });

  it('every live-table mapping names a list that exists', () => {
    expect([...liveRoots].filter((r) => !defined.has(r))).toEqual([]);
  });

  it('every list has a declared refresh mode', () => {
    const missing = [...defined.keys()].filter((r) => !(r in REFRESH_POLICY));
    expect(
      missing,
      'add these roots to REFRESH_POLICY (refresh-policy.ts) — see CLAUDE.md §22',
    ).toEqual([]);
  });

  it('declares no list that no longer exists', () => {
    expect(Object.keys(REFRESH_POLICY).filter((r) => !defined.has(r))).toEqual([]);
  });

  it("'live' lists are mapped from a live table", () => {
    const wrong = Object.entries(REFRESH_POLICY)
      .filter(([root, rule]) => rule.mode === 'live' && !liveRoots.has(root))
      .map(([root]) => root);
    expect(wrong, 'map them in LIVE_TABLE_KEYS or declare poll / on-open').toEqual([]);
  });

  it("'poll' lists set refetchInterval where they are defined", () => {
    const wrong = Object.entries(REFRESH_POLICY)
      .filter(([root, rule]) => {
        if (rule.mode !== 'poll') return false;
        return ![...(defined.get(root) ?? [])].some((f) => polls.has(moduleOf(f)));
      })
      .map(([root]) => root);
    expect(wrong).toEqual([]);
  });
});
