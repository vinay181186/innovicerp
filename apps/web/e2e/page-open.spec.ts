import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * CLAUDE.md §23 — opens every page on TEST and fails on the crash screen. Read-only.
 * The release script runs it (playwright.page-open.config.ts).
 *
 * Pages come from the route files, so a new page is covered without touching this
 * file. A route with an id in its path ($id) is not opened: it has no fixed address.
 */
const SRC = join(import.meta.dirname, '..', 'src');
const NOT_A_SCREEN = /^\/?(login|auth\/|__ui-kit)/;
// Screens chosen by ?view= rather than by path.
const VIEWS = ['daylog', 'team', 'teams', 'approvals'].map((v) => `/task-board?view=${v}`);

function routePaths(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routePaths(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) return [];
    const text = readFileSync(path, 'utf8');
    return [...text.matchAll(/createRoute\(\{[\s\S]{0,300}?path:\s*['"`]([^'"`]+)['"`]/g)].map(
      (m) => m[1] ?? '',
    );
  });
}

const pages = [
  ...new Set([
    ...routePaths(SRC)
      .filter((p) => p && !p.includes('$') && !NOT_A_SCREEN.test(p))
      .map((p) => (p.startsWith('/') ? p : `/${p}`)),
    ...VIEWS,
  ]),
].sort();

test('the route files were found', () => {
  expect(pages.length).toBeGreaterThan(50);
});

for (const page of pages) {
  test(`opens ${page}`, async ({ page: tab }) => {
    await tab.goto(page, { waitUntil: 'domcontentloaded' });
    // A crash often comes only when the data arrives, so let the page finish loading.
    await tab.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await expect(tab.getByText(/^Something went wrong!?$/)).toHaveCount(0);
  });
}
