// The ONE standard (owner 2026-11-04), held by a test: a new screen cannot bring back a
// hand-made copy of something the ERP already has. CI fails and names the file. To add a
// real exception, add it to the list here with its reason.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
