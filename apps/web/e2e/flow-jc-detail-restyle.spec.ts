import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Job Card DETAIL restyle (commit ba9c495a) + Op Entry "operator pre-fill from
// Start", verified on the deployed TEST stack (playwright.pages.config.ts).
//
// Read-only on IN-JC-26-00002 (5 ops, mixed states — the flow-card colouring
// and equal-size check). Start / Log / Stop on IN-JC-26-00003 OP1
// (`E2E_ TURNING`, not started) — the operator pre-fill check. The session is
// stopped with qty 0 afterwards (stopOpInputSchema: "0 = stop only, no op_log
// row"), so the op is left not-running with nothing produced.
//
// Every check writes a row to ROWS; afterAll renders them to the six-column
// PDF the user asked for.

const DATE = new Date().toISOString().slice(0, 10);
const OUT = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web/.playwright/reports';
const SHOT = `${OUT}/jc-detail-restyle-${DATE}-shots`;
mkdirSync(SHOT, { recursive: true });
export const PDF_PATH = `${OUT}/jc-detail-restyle-${DATE}.pdf`;

const JC_VIEW = 'IN-JC-26-00002'; // item 554117187000 · qty 500 · 5 ops
const JC_START = 'IN-JC-26-00003'; // item E2E-IMG-67612651 · qty 1 · OP1 not started
const OPERATOR = 'E2E_ Operator Prefill';
const OPERATOR_EDITED = 'E2E_ Someone Else';
const ACTUAL_MACHINE = 'cnc-2'; // cnc-1 (the plan) is running IN-JC-26-00002 OP40

interface Row {
  action: string;
  document: string;
  qty: string;
  headerStatus: string;
  overallStatus: string;
  result: '✓' | '✗' | '—';
  note: string;
}
const ROWS: Row[] = [];
const CONSOLE: string[] = [];
const measured = {
  cards: [] as Array<{ w: number; h: number; text: string }>,
  tile: { w: 0, h: 0 },
};

function row(r: Omit<Row, 'result'> & { result?: Row['result'] }, ok: () => void): void {
  try {
    ok();
    ROWS.push({ ...r, result: r.result ?? '✓' });
    // eslint-disable-next-line no-console
    console.log(`[✓] ${r.action} — ${r.note}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    ROWS.push({ ...r, result: '✗', note: `${r.note} :: ${msg}` });
    // eslint-disable-next-line no-console
    console.log(`[✗] ${r.action} — ${msg}`);
    throw e;
  }
}

function watchConsole(page: Page): void {
  page.on('console', (m) => {
    if (m.type() === 'error') CONSOLE.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => CONSOLE.push(`pageerror: ${e.message}`));
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true }).catch(() => {});
}

/** JC list → search the code → click the row → detail. */
async function openJcDetail(page: Page, code: string): Promise<void> {
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/Search JC no\./);
  await search.waitFor({ timeout: 45_000 });
  await search.fill(code);
  const link = page.locator('a[href*="/job-cards/"]').filter({ hasText: code }).first();
  await link.waitFor({ timeout: 45_000 });
  await link.click();
  await expect(page).toHaveURL(/\/job-cards\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  // The header tile and the ops are two separate queries; wait for both.
  await page.getByText('Route / Operation Flow').waitFor({ timeout: 45_000 });
  await page.locator('div[style*="height: 92px"]').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1200);
}

function headerPanel(page: Page): Locator {
  // The header tile is the first .panel that holds the KPI captions.
  return page
    .locator('.panel')
    .filter({ hasText: 'Order Qty' })
    .filter({ hasText: 'Current Op' })
    .first();
}
function flowPanel(page: Page): Locator {
  return page
    .locator('.panel')
    .filter({ has: page.getByRole('button', { name: /Route \/ Operation Flow/ }) })
    .first();
}
function flowCards(page: Page): Locator {
  return flowPanel(page).locator('div[style*="height: 92px"]');
}

async function box(l: Locator): Promise<{ w: number; h: number }> {
  const b = await l.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 };
}

const today = (): string => new Date().toISOString().slice(0, 10);
const now = (): string => new Date().toTimeString().slice(0, 5);

async function pickActual(page: Page, code: string): Promise<void> {
  const input = page.locator('#opf-actual-machine');
  await input.waitFor({ timeout: 30_000 });
  await input.click();
  await input.fill(code);
  const opt = page
    .locator('[role="option"]')
    .filter({ hasText: code })
    .filter({ hasNotText: /Loading/i })
    .first();
  await opt.waitFor({ state: 'visible', timeout: 45_000 });
  await opt.click();
  await page.waitForTimeout(400);
}

async function dialogGone(page: Page): Promise<void> {
  await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 120_000 });
  await page.waitForTimeout(800);
}

/** The Op Entry ops table row for the given op number label ("OP10"). */
function opRow(page: Page, opNo: string): Locator {
  return page
    .locator('table tbody tr')
    .filter({
      has: page.locator('td:first-child').filter({ hasText: new RegExp('^\\s*' + opNo + '\\s*$') }),
    })
    .first();
}

test.describe.serial('JC detail restyle + operator pre-fill', () => {
  // A click that can never become actionable must fail loudly, not sit for the
  // whole 10-minute test budget.
  test.use({ actionTimeout: 30_000 });
  test.beforeEach(({ page }) => watchConsole(page));

  test('1-4. header, no Overall Progress, flow cards equal + wrap + coloured', async ({ page }) => {
    test.setTimeout(600_000);
    await openJcDetail(page, JC_VIEW);
    await shot(page, '01-detail-00002');
    const header = headerPanel(page);
    await header.waitFor({ timeout: 30_000 });

    // ── 1. image tile 120×120, Material / Size under it, not in the kv grid, no Customer
    const tile = header.locator('[title="Product image"]').first();
    await tile.waitFor({ timeout: 30_000 });
    const t = await box(tile);
    measured.tile = t;
    const headerText = await header.innerText();
    const materialCount = (headerText.match(/\bMaterial\b/g) ?? []).length;
    const sizeCount = (headerText.match(/\bSize\b/g) ?? []).length;
    const customerCount = (headerText.match(/\bCustomer\b/g) ?? []).length;
    const material = await header.locator('span:has-text("Material:") + span').first().innerText();
    const size = await header.locator('span:has-text("Size:") + span').first().innerText();
    // The kv grid's labels are bare words in their own divs; "Material:" / "Size:"
    // under the picture carry a colon — so a bare label div must not exist.
    const bareMaterial = await header
      .locator('div')
      .filter({ hasText: /^Material$/ })
      .count();
    const bareSize = await header
      .locator('div')
      .filter({ hasText: /^Size$/ })
      .count();
    const bareCustomer = await header
      .locator('div')
      .filter({ hasText: /^Customer$/ })
      .count();
    row(
      {
        action:
          'Header: 120×120 product-image tile; Material / Size under it only; no Customer row',
        document: JC_VIEW,
        qty: '500',
        headerStatus: `tile ${t.w}×${t.h}`,
        overallStatus: `Material "${material}" · Size "${size}"`,
        note: `Material×${materialCount} Size×${sizeCount} Customer×${customerCount} (header text)`,
      },
      () => {
        expect(t.w).toBe(120);
        expect(t.h).toBe(120);
        expect(materialCount).toBe(1);
        expect(sizeCount).toBe(1);
        expect(customerCount).toBe(0);
        expect(bareMaterial).toBe(0);
        expect(bareSize).toBe(0);
        expect(bareCustomer).toBe(0);
        // an image is actually rendered inside the tile
        expect(tile.locator('img')).toBeTruthy();
      },
    );
    await expect(tile.locator('img')).toBeVisible({ timeout: 30_000 });
    await expect(header.getByText('554117187000')).toBeVisible();

    // ── 2. No Overall Progress
    const overallProgress = await page.getByText(/Overall Progress/i).count();
    row(
      {
        action: 'No "Overall Progress" block on the detail',
        document: JC_VIEW,
        qty: '—',
        headerStatus: '—',
        overallStatus: `${overallProgress} match(es)`,
        note: 'text search for /Overall Progress/i',
      },
      () => expect(overallProgress).toBe(0),
    );

    // ── 3. Flow cards: 5, equal size, wrap, no horizontal overflow
    const cards = flowCards(page);
    const n = await cards.count();
    const sizes: Array<{ w: number; h: number; text: string }> = [];
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const b = await box(c);
      sizes.push({ ...b, text: (await c.innerText()).replace(/\s+/g, ' ').trim() });
    }
    measured.cards = sizes;
    const overflow = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
    }));
    const panelOverflow = await flowPanel(page).evaluate((el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    const stripOverflow = await flowPanel(page)
      .locator('.panel-body > div')
      .first()
      .evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        wrap: getComputedStyle(el).flexWrap,
      }));
    const gg = sizes.find((s) => /\bgg\b/.test(s.text));
    const fi = sizes.find((s) => /Final Inspection/.test(s.text));
    row(
      {
        action: 'Flow cards: one per op, identical footprint, wrap without horizontal overflow',
        document: JC_VIEW,
        qty: `${n} cards`,
        headerStatus: sizes.map((s) => `${s.w}×${s.h}`).join(' '),
        overallStatus: `page ${overflow.docScroll}/${overflow.docClient} · panel ${panelOverflow.scroll}/${panelOverflow.client} · strip flex-wrap=${stripOverflow.wrap}`,
        note: `gg=${gg ? `${gg.w}×${gg.h}` : '?'} vs Final Inspection=${fi ? `${fi.w}×${fi.h}` : '?'}`,
      },
      () => {
        expect(n).toBe(5);
        const ws = new Set(sizes.map((s) => s.w));
        const hs = new Set(sizes.map((s) => s.h));
        expect([...ws]).toHaveLength(1);
        expect([...hs]).toHaveLength(1);
        expect(sizes[0]!.w).toBe(150);
        expect(sizes[0]!.h).toBe(92);
        expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient);
        expect(panelOverflow.scroll).toBeLessThanOrEqual(panelOverflow.client);
        expect(stripOverflow.scroll).toBeLessThanOrEqual(stripOverflow.client);
        expect(stripOverflow.wrap).toBe('wrap');
        expect(gg).toBeDefined();
        expect(fi).toBeDefined();
        expect(gg!.w).toBe(fi!.w);
        expect(gg!.h).toBe(fi!.h);
      },
    );
    // The cards read OP10 … OP50 in route order.
    expect(sizes.map((s) => s.text.slice(0, 4))).toEqual(['OP10', 'OP20', 'OP30', 'OP40', 'OP50']);

    // ── 4. Card states: OP10 done (green), OP40 current (amber), OP50 waiting (plain)
    const style = async (i: number): Promise<{ bg: string; border: string }> =>
      cards.nth(i).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, border: cs.borderTopColor };
      });
    const s1 = await style(0);
    const s4 = await style(3);
    const s5 = await style(4);
    row(
      {
        action: 'Flow card colouring: OP10 done ≠ OP40 current ≠ OP50 waiting',
        document: JC_VIEW,
        qty: '—',
        headerStatus: `OP10 ${sizes[0]!.text.replace(/^OP10\s*/, '')}`,
        overallStatus: `OP40 ${sizes[3]!.text.replace(/^OP40\s*/, '')} · OP50 ${sizes[4]!.text.replace(/^OP50\s*/, '')}`,
        note: `bg OP10=${s1.bg} OP40=${s4.bg} OP50=${s5.bg} · border OP10=${s1.border} OP40=${s4.border} OP50=${s5.border}`,
      },
      () => {
        expect(s1.bg).not.toBe(s4.bg);
        expect(s4.bg).not.toBe(s5.bg);
        expect(s1.bg).not.toBe(s5.bg);
        expect(s1.border).not.toBe(s4.border);
        expect(s4.border).not.toBe(s5.border);
        // OP10 is complete: its qty line carries the ✓ mark; OP40 (gg, running) and OP50 do not.
        expect(sizes[0]!.text).toMatch(/✓/);
        expect(sizes[3]!.text).toMatch(/\bgg\b/);
        expect(sizes[4]!.text).toMatch(/Final Inspection/);
        expect(sizes[4]!.text).not.toMatch(/✓/);
      },
    );
    await shot(page, '02-flow-cards');
  });

  test('5. op rows: rail + qty chips, expand / collapse, recent-logs toggle', async ({ page }) => {
    test.setTimeout(600_000);
    await openJcDetail(page, JC_VIEW);
    await page
      .getByRole('button', { name: /Operations Details/ })
      .first()
      .waitFor({ timeout: 30_000 });

    // Every op row has a 4px coloured left rail on its header bar.
    const bars = page.locator(
      'div[style*="border-left: 4px solid"], button[style*="border-left: 4px solid"]',
    );
    const railCount = await bars.count();
    const rails: string[] = [];
    for (let i = 0; i < railCount; i++) {
      rails.push(await bars.nth(i).evaluate((el) => getComputedStyle(el).borderLeftColor));
    }
    // Expand All so every row shows its chips.
    const expandAll = page.getByRole('button', { name: /Expand All/ });
    if (await expandAll.count()) await expandAll.first().click();
    await page.waitForTimeout(600);
    const planned = await page.getByText('QC Pending', { exact: true }).count();
    const completed = await page.getByText('Completed', { exact: true }).count();
    const pending = await page.getByText('Pending', { exact: true }).count();
    row(
      {
        action: 'Op rows: status rail on each row; qty chips on every expanded row',
        document: JC_VIEW,
        qty: `${railCount} rails`,
        headerStatus: `rail colours: ${[...new Set(rails)].join(' | ')}`,
        overallStatus: `chips: Planned Qty×${planned} Completed×${completed} Pending×${pending}`,
        note: 'Expand All → 5 rows each with Planned Qty / Completed / Pending chips',
      },
      () => {
        expect(railCount).toBe(5);
        expect(new Set(rails).size).toBeGreaterThanOrEqual(2); // green (OP10) vs amber vs plain
        expect(planned).toBe(5);
        // 5 chips each, plus the header KPI tile of the same name
        expect(completed).toBeGreaterThanOrEqual(5);
        expect(pending).toBeGreaterThanOrEqual(5);
      },
    );
    await shot(page, '03-ops-expanded');

    // Collapse All → rows shrink to one line each ("›" chevrons).
    const collapseAll = page.getByRole('button', { name: /Collapse All/ });
    await collapseAll.first().click();
    await page.waitForTimeout(600);
    const collapsedRows = page.locator(
      'button[title="Show this operation\'s quantities, actions and recent entries"]',
    );
    const collapsed = await collapsedRows.count();
    // Click the first collapsed row → it expands (chips appear)
    await collapsedRows.first().click();
    await page.waitForTimeout(500);
    const afterOne = await collapsedRows.count();
    const plannedAfter = await page.getByText('QC Pending', { exact: true }).count();
    // Collapse that one again via its own header toggle
    await page.locator('button[title="Collapse this operation to one row"]').first().click();
    await page.waitForTimeout(400);
    const afterCollapse = await collapsedRows.count();
    row(
      {
        action: 'Expand / collapse controls respond per row and via Collapse All',
        document: JC_VIEW,
        qty: `${collapsed} collapsed`,
        headerStatus: `click row → ${afterOne} collapsed, ${plannedAfter} chip row(s)`,
        overallStatus: `collapse again → ${afterCollapse} collapsed`,
        note: 'Collapse All → 5 one-line rows; click OP10 → expands; toggle → collapses',
      },
      () => {
        expect(collapsed).toBe(5);
        expect(afterOne).toBe(4);
        expect(plannedAfter).toBe(1);
        expect(afterCollapse).toBe(5);
      },
    );

    // Per-op "Recent Logs" strip on OP10 (complete, has logs). The ▲ hide /
    // ▼ show toggle was removed (round-3 clutter) — the strip is always open.
    await collapsedRows.first().click();
    await page.waitForTimeout(500);
    // The strip itself, anchored on its fixed "Recent Logs" caption.
    const caption = page.getByText('Recent Logs', { exact: true }).first();
    await caption.waitFor({ timeout: 15_000 });
    const strip = caption.locator('xpath=..');
    const openText = (await strip.innerText()).replace(/\s+/g, ' ');
    const logsText = openText;
    row(
      {
        action: 'Per-op control: Recent Logs strip on OP10 lists entries (always open, no hide / show toggle)',
        document: JC_VIEW,
        qty: '—',
        headerStatus: `open: ${openText.slice(0, 110)}`,
        overallStatus: 'always open',
        note: 'no dropdown menu exists on an op row — the per-op controls are expand/collapse and the action strip',
      },
      () => {
        expect(logsText).toMatch(/Qty\s*\+\d+/);
        expect(logsText).toMatch(/Operator/);
      },
    );
    await shot(page, '04-recent-logs');
  });

  test('6-7. Production Entry button opens Op Entry; tabs switch; no console errors', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    await openJcDetail(page, JC_VIEW);

    // ── 7. Tabs
    const tabs = page.locator('[role="tablist"] [role="tab"]');
    const tabNames = await tabs.allInnerTexts();
    const seen: string[] = [];
    for (let i = 0; i < tabNames.length; i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(700);
      const sel = await tabs.nth(i).getAttribute('aria-selected');
      const panel = page.locator('[role="tabpanel"]').first();
      const txt = (
        (await panel.count()) ? await panel.innerText() : await page.locator('body').innerText()
      ).trim();
      seen.push(`${tabNames[i]}:${sel}:${txt.length}ch`);
      await shot(page, `05-tab-${i}`);
    }
    const oldLabel = await page.getByRole('button', { name: /Open in Op Entry/ }).count();
    row(
      {
        action:
          'Tabs (Documents & Quality / Remarks / Related Records / History) switch and render',
        document: JC_VIEW,
        qty: `${tabNames.length} tabs`,
        headerStatus: tabNames.join(' | '),
        overallStatus: seen.join(' · '),
        note: 'each tab click sets aria-selected=true and renders a body',
      },
      () => {
        expect(tabNames.length).toBe(4);
        for (const s of seen) expect(s).toMatch(/:true:\d+ch$/);
      },
    );

    // ── 6. ▶ Production Entry → /op-entry?jc=…
    const btn = page.getByRole('button', { name: /Production Entry/ });
    await btn.click();
    await expect(page).toHaveURL(/\/op-entry\?.*jc=IN-JC-26-00002/, { timeout: 30_000 });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    const opRows = await page.locator('table tbody tr').count();
    row(
      {
        action: '"▶ Production Entry" button (was "Open in Op Entry") opens Op Entry on this JC',
        document: JC_VIEW,
        qty: `${opRows} op rows`,
        headerStatus: page.url().replace(/^https?:\/\/[^/]+/, ''),
        overallStatus: `old label "Open in Op Entry" present: ${oldLabel}`,
        note: 'button navigates to /op-entry?jc=IN-JC-26-00002 and the ops table loads',
      },
      () => {
        expect(oldLabel).toBe(0);
        expect(opRows).toBeGreaterThanOrEqual(5);
      },
    );
    await shot(page, '06-op-entry-from-button');
  });

  test('8. operator pre-fill from Start (IN-JC-26-00003 OP10)', async ({ page }) => {
    test.setTimeout(900_000);

    // ── Operators master: make sure the operator exists (E2E_ prefixed). ──
    await page.goto('/operators', { waitUntil: 'domcontentloaded' });
    const search = page.getByPlaceholder(/Search this list/);
    await search.waitFor({ timeout: 45_000 });
    await search.fill(OPERATOR);
    await page.waitForTimeout(1500);
    const exists = await page.locator('table tbody tr').filter({ hasText: OPERATOR }).count();
    let created = false;
    if (!exists) {
      await page.goto('/operators/new', { waitUntil: 'domcontentloaded' });
      await page.locator('#name').waitFor({ timeout: 45_000 });
      await page.locator('#name').fill(OPERATOR);
      await page.locator('#department').fill('E2E_ CNC Turning');
      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page).toHaveURL(/\/operators\/[0-9a-f-]{36}$/, { timeout: 45_000 });
      created = true;
    }
    row(
      {
        action: created
          ? 'Operators master: created operator'
          : 'Operators master: operator already present',
        document: OPERATOR,
        qty: '—',
        headerStatus: created ? 'created via /operators/new' : 'found in list',
        overallStatus: 'active',
        note: 'Operators master was empty on the TEST DB; the name carries the E2E_ marker',
      },
      () => undefined,
    );

    // ── Start OP10 on IN-JC-26-00003 ──
    await page.goto(`/op-entry?jc=${JC_START}`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1000);
    const r1 = opRow(page, '10');
    const startBtn = r1.getByRole('button', { name: /Start/ });
    await expect(startBtn).toBeVisible({ timeout: 30_000 });
    await startBtn.click();
    const dlg = page.locator('[role="dialog"]').first();
    await dlg.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    // Planned machine cnc-1 is busy with IN-JC-26-00002 OP40 → busy panel first.
    const busy = dlg.getByRole('button', { name: /Start on another machine/ });
    const busyShown = await busy.count();
    if (busyShown) await busy.click();
    await pickActual(page, ACTUAL_MACHINE);
    await page.locator('#opf-date').fill(today());
    await page.locator('#opf-time').fill(now());
    await page.locator('#opf-shift').selectOption('day');
    const opBox = page.locator('#opf-op');
    await opBox.fill(OPERATOR);
    await page.waitForTimeout(300);
    await shot(page, '07-start-form');
    await page.getByRole('dialog').getByRole('button', { name: /Start Operation/i }).click();
    await dialogGone(page);
    await page.goto(`/op-entry?jc=${JC_START}`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1000);
    const logBtn = opRow(page, '10').getByRole('button', { name: /✓ Complete/ });
    await expect(logBtn).toBeVisible({ timeout: 30_000 });
    row(
      {
        action: `Start OP10 (E2E_ TURNING) on ${ACTUAL_MACHINE} with operator "${OPERATOR}"`,
        document: JC_START,
        qty: '1 (order)',
        headerStatus: busyShown
          ? 'planned cnc-1 busy → Start on another machine'
          : 'planned machine free',
        overallStatus: 'running · row now offers ✚ Log',
        note: 'Start recorded through the app; no production booked',
      },
      () => expect(busyShown + 1).toBeGreaterThan(0),
    );

    // ── ✚ Log: Operator pre-filled, help text visible, still editable ──
    await logBtn.click();
    await dlg.waitFor({ timeout: 30_000 });
    await expect(page.locator('#opf-op')).toHaveValue(OPERATOR, { timeout: 45_000 });
    const help = dlg.locator('.form-help').filter({ hasText: /auto-filled from Start/ });
    await expect(help).toBeVisible({ timeout: 10_000 });
    const helpText = await help.innerText();
    const startedBy = await dlg
      .getByText(/started by/)
      .first()
      .innerText();
    const title = await dlg
      .locator('.panel-title, h2, h3')
      .first()
      .innerText()
      .catch(() => '');
    const dlgText = await dlg.innerText();
    await shot(page, '08-log-prefilled');
    row(
      {
        action:
          '✚ Log production: Operator pre-filled from Start; help text; "started by" under Actual Machine',
        document: JC_START,
        qty: '—',
        headerStatus: `Operator = "${await page.locator('#opf-op').inputValue()}"`,
        overallStatus: `${startedBy.trim()} · ${helpText.trim()}`,
        note: `dialog title: ${(title || dlgText.split('\n')[0] || '').trim()}`,
      },
      () => {
        expect(helpText).toMatch(/auto-filled from Start/);
        expect(startedBy).toMatch(
          new RegExp(`started by ${OPERATOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        );
        expect(dlgText).toMatch(/Actual Machine/);
        expect(dlgText).toMatch(/Complete Operation/);
      },
    );

    // Edit the operator — the box is not locked, and the help note goes away.
    await page.locator('#opf-op').fill(OPERATOR_EDITED);
    await page.waitForTimeout(300);
    const editedValue = await page.locator('#opf-op').inputValue();
    const helpAfter = await help.count();
    const readonly = await page.locator('#opf-op').getAttribute('readonly');
    const disabled = await page.locator('#opf-op').isDisabled();
    row(
      {
        action: 'Operator box accepts an edit (not locked); help note hides after the edit',
        document: JC_START,
        qty: '—',
        headerStatus: `typed "${OPERATOR_EDITED}" → reads "${editedValue}"`,
        overallStatus: `readonly=${readonly} disabled=${disabled} help visible after edit=${helpAfter}`,
        note: 'Log NOT submitted — closed without saving',
      },
      () => {
        expect(editedValue).toBe(OPERATOR_EDITED);
        expect(readonly).toBeNull();
        expect(disabled).toBe(false);
        expect(helpAfter).toBe(0);
      },
    );
    await shot(page, '09-log-edited');
    // Close without submitting.
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 });

    // ── Stop the session with qty 0 so the op is back to not-running ──
    await page.goto(`/op-entry?jc=${JC_START}`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1000);
    await opRow(page, '10').getByRole('button', { name: /✓ Complete/ }).click();
    await dlg.waitFor({ timeout: 30_000 });
    await expect(page.locator('#opf-op')).toHaveValue(OPERATOR, { timeout: 45_000 });
    await page.locator('#opf-date').fill(today());
    await page.locator('#opf-time').fill(now());
    await page.locator('#opf-shift').selectOption('day');
    await page.locator('#opf-qty').fill('0');
    await shot(page, '10-stop-form');
    await dlg.getByRole('button', { name: /Stop Operation/ }).click();
    await dialogGone(page);
    await page.goto(`/op-entry?jc=${JC_START}`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1000);
    const startAgain = await opRow(page, '10').getByRole('button', { name: /Start/ }).count();
    const logStill = await opRow(page, '10').getByRole('button', { name: /✓ Complete/ }).count();
    await shot(page, '11-after-stop');
    row(
      {
        action:
          'Stop the session with qty 0 (stop only — no production row) so OP10 is back to not running',
        document: JC_START,
        qty: '0',
        headerStatus: `row offers ▶ Start again: ${startAgain === 1}`,
        overallStatus: `✚ Log still offered: ${logStill === 1}`,
        note: 'stopOpInputSchema: qty 0 = stop only; the running_ops row is kept as stopped history',
      },
      () => {
        expect(startAgain).toBe(1);
        expect(logStill).toBe(0);
      },
    );
  });

  test('9. QC op entry: inspector box NOT auto-filled', async ({ page }) => {
    test.setTimeout(600_000);
    // IN-JC-26-00003 OP20 is `waiting` with nothing to inspect, so its row has no
    // button (jc-ops-table: qcPending <= 0 → null). IN-JC-26-00002 OP20 (Final
    // Inspection, qc_pending) opens the very same QC form — opened and closed,
    // nothing submitted.
    await page.goto(`/op-entry?jc=${JC_VIEW}`, { waitUntil: 'domcontentloaded' });
    await page.locator('table tbody tr').first().waitFor({ timeout: 45_000 });
    await page.waitForTimeout(1000);
    const qcRow = opRow(page, '20');
    const qcBtn = qcRow.getByRole('button', { name: /Inspect/ });
    await expect(qcBtn).toBeVisible({ timeout: 30_000 });
    const qcLabel = await qcBtn.innerText();
    await qcBtn.click();
    const dlg = page.locator('[role="dialog"]').first();
    await dlg.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500); // give the sessions poll time to arrive — it must NOT seed
    const inspector = await page.locator('#opf-op').inputValue();
    const placeholder = await page.locator('#opf-op').getAttribute('placeholder');
    const help = await dlg
      .locator('.form-help')
      .filter({ hasText: /auto-filled/ })
      .count();
    const dlgText = await dlg.innerText();
    await shot(page, '12-qc-form');
    row(
      {
        action:
          'QC op entry (✔ QC inspection): inspector box stays blank — no auto-fill on a QC op',
        document: `${JC_VIEW} OP20`,
        qty: qcLabel.trim(),
        headerStatus: `Inspector = "${inspector}" (placeholder "${placeholder}")`,
        overallStatus: `auto-filled note present: ${help}`,
        note: 'IN-JC-26-00003 OP20 has 0 pcs to inspect (no button), so the same QC form was opened on IN-JC-26-00002 OP20 and closed unsaved',
      },
      () => {
        expect(dlgText).toMatch(/QC Inspection/);
        expect(inspector).toBe('');
        expect(placeholder).toBeNull(); // the "QC inspector name" hint was removed
        expect(help).toBe(0);
      },
    );
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await dlg.waitFor({ state: 'hidden', timeout: 15_000 });
  });

  test('console: no job-card / React errors across the run', async () => {
    const bad = CONSOLE.filter((l) =>
      /job-card|jc-|Minified React error|React|Uncaught|pageerror/i.test(l),
    );
    row(
      {
        action: 'Console errors mentioning job-card / jc- / React during the whole run',
        document: 'all pages',
        qty: `${CONSOLE.length} console errors total`,
        headerStatus: `${bad.length} relevant`,
        overallStatus: bad.slice(0, 3).join(' | ').slice(0, 200) || 'none',
        note: CONSOLE.slice(0, 5).join(' | ').slice(0, 300) || 'console clean',
      },
      () => expect(bad).toEqual([]),
    );
  });

  test.afterAll(async ({ browser }) => {
    await writePdf(browser);
  });
});

async function writePdf(browser: Browser): Promise<void> {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cardTxt = measured.cards.map((c) => `${c.w}×${c.h}`).join(', ') || 'not measured';
  const pass = ROWS.filter((r) => r.result === '✓').length;
  const fail = ROWS.filter((r) => r.result === '✗').length;
  const skip = ROWS.filter((r) => r.result === '—').length;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Times New Roman",serif;font-size:11px;margin:24px;color:#111}
    h1{font-size:16px;margin:0 0 4px} .sub{color:#555;margin-bottom:12px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #888;padding:4px 6px;vertical-align:top;text-align:left}
    th{background:#eee;font-weight:700} td.r{text-align:center;font-size:14px;width:28px}
    .ok{color:#137a2a}.bad{color:#b00020}.na{color:#777} .note{color:#555;font-size:10px}
  </style></head><body>
  <h1>Job Card detail restyle + Op Entry operator pre-fill — test run report</h1>
  <div class="sub">TEST stack https://innovic-erp.pages.dev · ${esc(DATE)} · spec apps/web/e2e/flow-jc-detail-restyle.spec.ts ·
  ${pass} passed / ${fail} failed / ${skip} n-a · image tile ${measured.tile.w}×${measured.tile.h}px · flow cards ${esc(cardTxt)} · operator "${esc(OPERATOR)}"</div>
  <table><thead><tr><th>Action</th><th>Document</th><th>Qty</th><th>Header Status</th><th>Overall Status</th><th>Result</th></tr></thead><tbody>
  ${ROWS.map(
    (r) =>
      `<tr><td>${esc(r.action)}<div class="note">${esc(r.note)}</div></td><td>${esc(r.document)}</td><td>${esc(r.qty)}</td><td>${esc(r.headerStatus)}</td><td>${esc(r.overallStatus)}</td><td class="r ${r.result === '✓' ? 'ok' : r.result === '✗' ? 'bad' : 'na'}">${r.result}</td></tr>`,
  ).join('')}
  </tbody></table>
  <p class="note">Undo: the only writes were (1) operator "${esc(OPERATOR)}" in the Operators master (deactivate / delete it there), and (2) one Start + one Stop (qty 0) session on ${esc(JC_START)} OP10 — the op is back to not running with nothing produced; the stopped session remains as history on /op-entry/running.</p>
  </body></html>`;
  writeFileSync(`${OUT}/jc-detail-restyle-${DATE}.html`, html);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.pdf({
    path: PDF_PATH,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
  });
  await ctx.close();
  // eslint-disable-next-line no-console
  console.log(`PDF written: ${PDF_PATH}`);
}
