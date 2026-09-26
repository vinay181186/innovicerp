import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Planned vs Actual machine (ADR-164), driven through the deployed TEST stack:
//
//   JC op planned on cnc-1. Start it on cnc-2 through Group → Machine. Log 4,
//   Stop with 3. The plan must still read cnc-1; every produced piece must be
//   stamped cnc-2; the busy gate must key on cnc-2 while it runs; Op Log and
//   the Job Card must show both machines for what they are.
//
// Every step writes a row to STEPS and a screenshot to SHOT for the report.

const SHOT =
  'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp/e90daca8-13d8-4c6a-9ffb-775ec274682c/scratchpad/am-run';
mkdirSync(SHOT, { recursive: true });

// Discovered on the TEST DB before the run: planned cnc-1, 10 pcs available,
// nothing running anywhere. A second card, also planned on cnc-1, proves the
// busy gate.
const JC = 'IN-JC-26-00009';
const JC_OTHER = 'IN-JC-26-00006';
const PLANNED = 'cnc-1';
const ACTUAL = 'cnc-2';
const LOG_QTY = 4;
const STOP_QTY = 3;

interface Step {
  n: number;
  stage: string;
  action: string;
  expected: string;
  observed: string;
  result: 'PASS' | 'FAIL' | 'INFO';
  shot?: string;
}
const STEPS: Step[] = [];

async function step(
  page: Page,
  stage: string,
  action: string,
  expected: string,
  check: () => Promise<string>,
): Promise<void> {
  const n = STEPS.length + 1;
  const shot = `${String(n).padStart(2, '0')}-${stage.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  let observed = '';
  let result: Step['result'] = 'PASS';
  try {
    observed = await check();
  } catch (e) {
    observed = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    result = 'FAIL';
  }
  await page.screenshot({ path: `${SHOT}/${shot}`, fullPage: true }).catch(() => {});
  STEPS.push({ n, stage, action, expected, observed, result, shot });
  // eslint-disable-next-line no-console
  console.log(`[${result}] ${n}. ${stage} — ${observed.slice(0, 140)}`);
  writeFileSync(`${SHOT}/steps.json`, JSON.stringify({ steps: STEPS }, null, 2));
  if (result === 'FAIL') throw new Error(`Step ${n} failed: ${observed}`);
}

const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

async function loadJc(page: Page, jc: string): Promise<void> {
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const box = page.locator('#jc-input');
  await box.click();
  await box.fill(jc);
  const opt = page.locator('[role="option"]').filter({ hasText: jc }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);
}

async function fillEntryHeader(page: Page, operator: string): Promise<void> {
  await page.locator('#opf-date').fill(today());
  await page.locator('#opf-time').fill(now());
  await page.locator('#opf-shift').selectOption('day');
  await page.locator('#opf-op').first().fill(operator);
}

async function popupGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);
}

/** The first op row that offers the named action. */
function rowWith(page: Page, action: RegExp): Locator {
  return page.locator('table tbody tr').filter({ has: page.getByRole('button', { name: action }) }).first();
}

/** Pick a machine in the Actual Machine picker (SearchableSelect). */
async function pickActual(page: Page, code: string): Promise<void> {
  const input = page.locator('#opf-actual-machine');
  await input.click();
  await input.fill(code);
  const opt = page.locator('[role="option"]').filter({ hasText: code }).filter({ hasNotText: /Loading/i }).first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

test('planned vs actual machine: start on cnc-2, plan stays cnc-1', async ({ page }) => {
  test.setTimeout(900_000);

  // ── 1. Open Start on the planned-cnc-1 op ───────────────────────────────
  await loadJc(page, JC);
  await rowWith(page, /Start/).getByRole('button', { name: /Start/ }).click();
  await page.locator('[role="dialog"]').first().waitFor({ timeout: 30_000 });
  await page.locator('#opf-actual-machine').waitFor({ timeout: 30_000 });
  // The picker is seeded once the machines list is in; wait for a value, not a clock.
  await expect(page.locator('#opf-actual-machine')).toHaveValue(PLANNED, { timeout: 45_000 });
  await step(page, 'Start popup opens', `Op Entry → ${JC} → ▶ Start`, `Planned Machine = ${PLANNED} (read-only); Actual Machine defaults to ${PLANNED}`, async () => {
    const planned = await page.locator('#opf-machine').inputValue();
    const actual = await page.locator('#opf-actual-machine').inputValue();
    const ro = await page.locator('#opf-machine').getAttribute('readonly');
    if (planned !== PLANNED) throw new Error(`planned box reads "${planned}"`);
    if (ro === null) throw new Error('planned box is editable');
    if (actual !== PLANNED) throw new Error(`actual defaulted to "${actual}"`);
    const grp = await page.locator('#opf-mgrp').inputValue();
    return `Planned ${planned} (read-only) · Group "${grp}" · Actual ${actual}`;
  });

  // ── 2. Change Actual to cnc-2 via the picker ────────────────────────────
  await pickActual(page, ACTUAL);
  await step(page, 'Change Actual Machine', `Actual Machine → ${ACTUAL}`, `Actual = ${ACTUAL}; Planned still ${PLANNED}; notice "(planned ${PLANNED})"`, async () => {
    const planned = await page.locator('#opf-machine').inputValue();
    const actual = await page.locator('#opf-actual-machine').inputValue();
    if (planned !== PLANNED) throw new Error(`planned changed to "${planned}"`);
    if (actual !== ACTUAL) throw new Error(`actual reads "${actual}"`);
    const dlg = await page.locator('[role="dialog"]').first().innerText();
    if (!new RegExp(`Planned Machine\\s*${PLANNED}[\\s\\S]{0,40}Actual Machine\\s*${ACTUAL}`).test(dlg)) {
      throw new Error('deviation note missing');
    }
    return `Planned ${planned} · Actual ${actual} · "as Running on ${ACTUAL} (planned ${PLANNED})"`;
  });

  // ── 3. Start ─────────────────────────────────────────────────────────────
  await fillEntryHeader(page, 'E2E Operator');
  await page.getByRole('button', { name: /Start Operation/i }).click();
  await popupGone(page);
  await step(page, 'Start on cnc-2', 'date/time/shift/operator → ▶ Start Operation', `Session running on ${ACTUAL}; ops row offers Log`, async () => {
    await loadJc(page, JC);
    const body = await page.locator('body').innerText();
    if (!/Log/.test(body)) throw new Error('op did not show as running');
    return 'Op running; row now offers ✚ Log';
  });

  // ── 4. Busy gate keys on the ACTUAL machine ─────────────────────────────
  await loadJc(page, JC_OTHER);
  await rowWith(page, /Start/).getByRole('button', { name: /Start/ }).click();
  await page.locator('#opf-actual-machine').waitFor({ timeout: 30_000 });
  await expect(page.locator('#opf-actual-machine')).toHaveValue(PLANNED, { timeout: 45_000 });
  await step(page, 'Other JC, planned cnc-1', `${JC_OTHER} → ▶ Start`, `No busy notice — ${PLANNED} is free`, async () => {
    const dlg = await page.locator('[role="dialog"]').first().innerText();
    if (/currently running/.test(dlg)) throw new Error('busy notice shown for a free machine');
    return `Actual ${PLANNED}, Start enabled, no notice`;
  });
  await pickActual(page, ACTUAL);
  await step(page, 'Busy gate', `Actual Machine → ${ACTUAL} (running ${JC})`, `Notice "${ACTUAL} is currently running ${JC} / Op 1"; Start disabled`, async () => {
    const notice = page.locator('[role="dialog"]').first().getByText(/currently running/);
    await notice.waitFor({ timeout: 30_000 });
    const txt = await page.locator('[role="dialog"]').first().innerText();
    if (!txt.includes(JC)) throw new Error('notice does not name the running JC');
    const disabled = await page.getByRole('button', { name: /Start Operation/i }).isDisabled();
    if (!disabled) throw new Error('Start still enabled');
    return `Notice names ${JC}; ▶ Start Operation disabled`;
  });
  // The machine listbox is portaled over the dialog; Escape closes it first,
  // then the dialog's own X.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('[role="dialog"] button[aria-label="Close"]').first().click({ force: true });
  await popupGone(page);

});
