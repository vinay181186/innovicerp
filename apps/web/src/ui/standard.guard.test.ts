// The ONE standard (owner 2026-11-04), held by a test: a new screen cannot bring back a
// hand-made copy of something the ERP already has. The release stops and names the file. To add a
// real exception, add it to the list here with its reason.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { env } from 'node:process';
import { isMoneyHeading } from '@innovic/shared';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'ui-kit' ? [] : tsxFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

const FILES = tsxFiles(SRC).map((path) => ({
  rel: relative(SRC, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}));

function offenders(pattern: RegExp, allowed: readonly string[] = []): string[] {
  return FILES.filter((f) => pattern.test(f.text) && !allowed.includes(f.rel)).map((f) => f.rel);
}

describe('one standard across the ERP', () => {
  it('a list hook sends withLineItems: a picker that asks for items must get them', () => {
    for (const mod of ['purchase-orders', 'delivery-challans', 'jw-dc']) {
      const api = readFileSync(join(SRC, 'modules', mod, 'api.ts'), 'utf8');
      expect(api, mod).toContain("params.set('withLineItems', 'true')");
    }
  });

  it('every pop-up uses the shared Modal', () => {
    expect(
      offenders(/className="overlay"/, [
        'ui/feedback/Modal.tsx', // the shared pop-up itself
        'lib/exit-guard.tsx', // the exit question itself, drawn above a Modal
        'modules/search/components/search-popup.tsx', // global search, not a form
      ]),
    ).toEqual([]);
  });

  it('no browser alert: use the toast', () => {
    expect(offenders(/\bwindow\.alert\(/)).toEqual([]);
  });

  it('no tile row on a list (owner 2026-11-03)', () => {
    const REPORTS = [
      'modules/daily-report/routes/list.tsx', // report page
      'modules/pending-so-value/routes/list.tsx', // report page
    ];
    const lists = FILES.filter(
      (f) => /modules\/[^/]+\/routes\/list\.tsx$/.test(f.rel) && !REPORTS.includes(f.rel),
    );
    expect(lists.filter((f) => /<StatStrip\b/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });

  it("a form's Save lives in FormActions, not in the page header", () => {
    const headerSave =
      /<PageHeader\b(?:(?!\/>|<\/PageHeader>)[\s\S])*?actions=\{[\s\S]{0,400}?(?:Save|type="submit")/;
    expect(offenders(headerSave)).toEqual([]);
  });

  it('the Related Documents panel names the item: no "Name / Ref" heading', () => {
    expect(offenders(/Name \/ Ref/)).toEqual([]);
  });

  it('a Related Documents item code is dark and bold, never `.td-code` blue', () => {
    const textOf = (rel: string): string => FILES.find((f) => f.rel === rel)?.text ?? '';
    const tabs = textOf('components/shared/related-docs-tabs.tsx');
    const registry = textOf('components/shared/related-docs-panel.tsx');
    expect(tabs).toContain('itemCodeWithRev');
    expect(tabs).not.toContain('td-code');
    expect(registry).toMatch(/\bitem: \(t, i\) => \(\s*<Link[^>]*>/);
    expect(registry).not.toMatch(/\bitem: \(t, i\) => \(\s*<Link[^>]*td-code/);
  });

  it('new code does not type a font size that has a token', () => {
    expect(offenders(/\bfontSize: *'?(?:11|12|13|16|22|28)(?:px)?'?\s*[,}]/)).toEqual([]);
  });
});

// The alignment rule (CLAUDE.md §24): text left, qty centre, money right. A list column
// gets it from `columnAlign`; these hold the hand-built tables to the same rule.
describe('one alignment across the ERP', () => {
  const MONEY = 'Rate|Amount|Value|Price|Cost|Taxable|Subtotal|Grand Total';

  it('a table cell never types its own alignment: use the classes', () => {
    expect(
      offenders(/<t[dh]\b[^>]*?textAlign/, [
        'ui/data/DataTable.tsx', // the full-width expanded row, not a column
        'modules/production-schedule/routes/list.tsx', // a calendar grid, not an innovic-table
      ]),
    ).toEqual([]);
  });

  it('a hand-built Qty heading is centred (`th-num`)', () => {
    expect(offenders(/<th\b(?![^>]*\bth-num\b)[^>]*>\s*[^<{]*\bQty\b/)).toEqual([]);
  });

  it('a hand-built money heading is right-aligned (`th-money`)', () => {
    const money = new RegExp(
      `<th\\b(?![^>]*\\bth-money\\b)[^>]*>\\s*(?:[^<{]*\\s)?(?:${MONEY})\\s*<`,
    );
    expect(offenders(money)).toEqual([]);
  });

  /** The column object around a position: walks to its own braces, so a property
   *  written before `header` counts and the next column's does not. */
  function objectAround(text: string, at: number): string {
    let open = at;
    for (let depth = 0; open > 0; open--) {
      const c = text[open - 1];
      if (c === '}') depth++;
      else if (c === '{' && depth-- === 0) break;
    }
    let close = at;
    for (let depth = 0; close < text.length; close++) {
      const c = text[close];
      if (c === '{') depth++;
      else if (c === '}' && depth-- === 0) break;
    }
    return text.slice(open, close);
  }

  const columnsWhere = (test: (heading: string, column: string) => boolean): string[] =>
    FILES.flatMap((f) =>
      [...f.text.matchAll(/header:\s*'([^']+)'/g)]
        .filter((m) => test(m[1] ?? '', objectAround(f.text, m.index)))
        .map((m) => `${f.rel}: ${m[1]}`),
    );

  it('a list column headed with a money word is numeric, so it aligns right', () => {
    const notNumeric = columnsWhere(
      (heading, column) =>
        new RegExp(`(^|\\s)(${MONEY})$`).test(heading) &&
        !/kind: 'num'|align: 'right'|money: true/.test(column),
    );
    expect(notNumeric).toEqual([]);
  });

  it('a list column that renders rupees says money, whatever its heading', () => {
    const plain = columnsWhere(
      (heading, column) =>
        /\b(inr|moneyCell|fmtInr|fmtINR|formatINR)\(/.test(column) &&
        !isMoneyHeading(heading) &&
        !/money: true/.test(column),
    );
    expect(plain).toEqual([]);
  });
});

// Frozen counts (CLAUDE.md §25, ADR-284): old screens keep what they have until they are cleaned
// up; no file may add more. `standard-frozen.json` holds today's count per file.
// - Over its count: fails and names the file. Fix the code; never raise the number by hand
//   unless the owner approved it. A renamed file moves its count to the new name.
// - Under its count (a clean-up): lower the numbers with
//   UPDATE_STANDARD_FREEZE=1 pnpm exec vitest run src/ui/standard.guard.test.ts
//   That command only ever lowers. The release ignores this one, so a clean-up never stops it.
describe('no new bypass of the shared pieces', () => {
  const FROZEN_PATH = join(__dirname, 'standard-frozen.json');
  const PRINT = /print/i; // a printed sheet is a fixed document, outside the screen theme
  const KIT = /^ui\//; // the kit is where the real table and dropdown are built

  const RULES: Record<string, { pattern: RegExp; allow?: RegExp; fix: string }> = {
    'hand-made table': {
      pattern: /<table\b/g,
      allow: new RegExp(`${KIT.source}|${PRINT.source}`, 'i'),
      fix: 'use DataTable or FitRows',
    },
    'plain dropdown': {
      pattern: /<select\b/g,
      allow: KIT,
      fix: 'use Select for a short fixed list, SearchableSelect for a master or document',
    },
    'typed colour': {
      pattern: /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi,
      allow: PRINT,
      fix: 'use a colour from the theme',
    },
    'typed spacing': {
      pattern:
        /\b(?:padding|margin|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Inline|Block)?\s*:\s*['"`]?-?[\d. ]*[1-9]/g,
      fix: 'use a spacing size from the theme',
    },
  };

  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

  const counts = (rule: string): Record<string, number> => {
    const { pattern, allow } = RULES[rule]!;
    const found: Record<string, number> = {};
    for (const f of FILES) {
      if (allow?.test(f.rel)) continue;
      const n = withoutComments(f.text).match(pattern)?.length ?? 0;
      if (n > 0) found[f.rel] = n;
    }
    return found;
  };

  const frozen = JSON.parse(readFileSync(FROZEN_PATH, 'utf8')) as Record<
    string,
    Record<string, number>
  >;

  if (env['UPDATE_STANDARD_FREEZE']) {
    const next = Object.fromEntries(
      Object.keys(RULES).map((rule) => {
        const old = frozen[rule];
        const lowered = Object.entries(counts(rule))
          .map(([file, n]) => [file, old ? Math.min(old[file] ?? 0, n) : n] as const)
          .filter(([, n]) => n > 0)
          .sort(([a], [b]) => a.localeCompare(b));
        return [rule, Object.fromEntries(lowered)];
      }),
    );
    writeFileSync(FROZEN_PATH, `${JSON.stringify(next, null, 2)}\n`);
    Object.assign(frozen, next);
  }

  it.each(Object.keys(RULES))('no file adds a %s', (rule) => {
    const over = Object.entries(counts(rule))
      .filter(([file, n]) => n > (frozen[rule]?.[file] ?? 0))
      .map(
        ([file, n]) => `${file}: ${n} (allowed ${frozen[rule]?.[file] ?? 0}): ${RULES[rule]!.fix}`,
      );
    expect(over).toEqual([]);
  });

  it.skipIf(env['STANDARD_RELEASE_CHECK'])('a cleaned-up file has its count lowered', () => {
    const stale = Object.keys(RULES).flatMap((rule) => {
      const now = counts(rule);
      return Object.entries(frozen[rule] ?? {})
        .filter(([file, n]) => (now[file] ?? 0) < n)
        .map(([file]) => `${rule}: ${file}`);
    });
    expect(stale).toEqual([]);
  });
});
