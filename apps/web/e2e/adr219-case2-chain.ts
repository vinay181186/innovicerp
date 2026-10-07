// ADR-219 CASE 2 — shared chain state + step helpers.
//
// TEST STACK ONLY (https://innovic-erp.pages.dev → api-test-…railway.app).
// Not a *.spec.ts, so Playwright never runs it as a test.
//
// Case 2 target state, on ONE brand-new job-work order:
//   ordered 10 · 5 sent on an outward challan · those 5 received · all 5 failed
//   Incoming QC · the deviation disposed "Return to Vendor" · NO return challan.
// So: fresh still owed = 5, waiting to go back = 5.
//
// Every free-text value carries the prefix ZZ-A219A- so these records can never
// be confused with the Case 1 agent's chain (which owns IN-JWPO-00005/R1 and
// NC-00005 — never touched from here).

import { expect, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export const TAG = 'ZZ-A219A-';
export const ORDER_QTY = 10;
export const SEND_QTY = 5;

/** The standing E2E vendor on the test stack (e2e/FIXTURES.md). */
export const VENDOR_CODE = 'VND-959';
/** An item that exists on the test stack (used by the other chain specs). */
export const ITEM_CODE = '554117144000';

const WEB = 'C:/Innovic_projects/innovic-erp/wt-dcscreens/apps/web';
export const STATE_FILE = WEB + '/.playwright/adr219a-state.json';
export const SHOT_DIR = WEB + '/.playwright/adr219a-shots';
mkdirSync(WEB + '/.playwright', { recursive: true });
mkdirSync(SHOT_DIR, { recursive: true });

export interface ChainState {
  apiBase?: string;
  soCode?: string;
  soUrl?: string;
  internalSoNo?: string;
  jcCode?: string;
  jcUrl?: string;
  opName?: string;
  prCode?: string;
  poId?: string;
  poCode?: string;
  dcId?: string;
  dcCode?: string;
  grnId?: string;
  grnCode?: string;
  ncCode?: string;
  ncUrl?: string;
  ncId?: string;
  disposed?: boolean;
  /** A JW/Service PO known to have NOTHING waiting to go back (proof 2). */
  cleanPoCode?: string;
}

export function readState(): ChainState {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as ChainState;
}
export function saveState(patch: ChainState): ChainState {
  const next = { ...readState(), ...patch };
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}
export function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log('>> ' + msg);
}
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true }).catch(() => {});
}

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Refuse to write anywhere but the TEST api. */
export async function assertTestStack(page: Page): Promise<string> {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).origin));
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const api = [...hosts].find((h) => h.includes('railway.app'));
  const where = `url=${page.url()} · hosts=${[...hosts].join(', ')} · body="${(
    await page.locator('body').innerText()
  )
    .replace(/\s+/g, ' ')
    .slice(0, 300)}"`;
  log(where);
  expect(api, 'no API host seen at all — ' + where).toBeTruthy();
  expect(api, 'REFUSING TO WRITE: api host is ' + api).toContain('api-test-');
  expect(page.url(), 'REFUSING TO WRITE: not the pages.dev test site').toContain(
    'innovic-erp.pages.dev',
  );
  return api!;
}

/** Pick a row out of a SearchableSelect by its element id. */
export async function pickFromCombo(
  page: Page,
  id: string,
  search: string,
  want: RegExp,
): Promise<void> {
  const box = page.locator('#' + id);
  await box.click();
  await box.fill(search);
  const option = page.getByRole('option').filter({ hasText: want }).first();
  await option.waitFor({ state: 'visible', timeout: 45_000 });
  await option.click();
  await page.waitForTimeout(400);
}

/** Pick the first real option out of a SearchableSelect found by locator. */
export async function pickFirst(page: Page, input: Locator, term: string): Promise<void> {
  await input.click();
  await input.fill(term);
  const opt = page
    .locator('[role="option"]')
    .filter({ hasNotText: /Loading/i })
    .first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

/** Column index of a header inside a table (0-based). */
export async function colIndex(table: Locator, header: RegExp): Promise<number> {
  const ths = table.locator('thead th');
  const n = await ths.count();
  const seen: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (await ths.nth(i).innerText()).trim();
    seen.push(t);
    if (header.test(t)) return i;
  }
  throw new Error(`no column matching ${header} — headers were: ${seen.join(' | ')}`);
}
