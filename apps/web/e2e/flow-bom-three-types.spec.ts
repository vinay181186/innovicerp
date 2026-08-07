import { expect, test, type Page } from '@playwright/test';

// A BOM whose three children use the three DIFFERENT line types, driven from
// creation through to whatever stops it:
//
//   child 1  manufacture  -> make it in-house  (Job Card)
//   child 2  purchase     -> buy it            (PR -> PO -> GRN)
//   child 3  outsource    -> send it out       (PR -> PO -> GRN)
//
// The point is to see what each TYPE actually spawns once an equipment SO
// explodes the BOM, and where a mixed-type assembly stalls on the way to a
// dispatch. Every step records a row for the report at the end; a step that is
// blocked says so and why rather than failing the run.
//
// WRITES TO PROD (authorized, same as the other flow-* specs).
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bom3"

test.describe.configure({ mode: 'serial' });

const CLIENT_CODE = 'CLI-009';
const CLIENT_MATCH = /Arindam Engineering/i;

/** The assembly being sold. Deliberately an item no other BOM builds, so the
 *  SO form's "find my BOM" lookup has exactly one answer. */
const PARENT = '554117150000';
const PARENT_NAME = /ARM CONNECTING/i;

interface Child {
  code: string;
  name: RegExp;
  /** The <option> value in the Type select. */
  type: 'manufacture' | 'purchase' | 'outsource';
  qtyPerSet: number;
}
const CHILDREN: Child[] = [
  { code: '554117144000', name: /COVER/i, type: 'manufacture', qtyPerSet: 1 },
  { code: '554117155000', name: /THREADED HOUSING/i, type: 'purchase', qtyPerSet: 2 },
  { code: '554117146000', name: /LEVER CATCH RAMMER/i, type: 'outsource', qtyPerSet: 3 },
];

const SO_QTY = 2;
const RATE = 750;
const TAG = `E2E-3TYPE-${Date.now()}`;

interface DocRow {
  step: string;
  doc: string;
  code: string;
  qty: string;
  status: string;
  note: string;
}
const REPORT: DocRow[] = [];
function record(r: DocRow): void {
  REPORT.push(r);
  // eslint-disable-next-line no-console
  console.log(`>> [${r.step}] ${r.doc} ${r.code} | qty ${r.qty} | ${r.status} | ${r.note}`);
}

const state = {
  bomNo: process.env['E2E_BOM3'] ?? '',
  soCode: process.env['E2E_SO3'] ?? '',
  planCodes: [] as string[],
};

/** Type a code into a picker and click the matching option in ITS listbox. */
async function pickInto(page: Page, fieldId: string, code: string): Promise<void> {
  const input = page.locator(`#${fieldId}`);
  await input.click();
  await input.fill(code);
  const opt = page.locator(`#${fieldId}-listbox [role="option"]`, { hasText: code }).first();
  await expect(opt, `option ${code} in ${fieldId}`).toBeVisible({ timeout: 30_000 });
  await opt.click();
  await page.waitForTimeout(500);
}

async function pickByPlaceholder(page: Page, ph: RegExp, term: string, opt: RegExp): Promise<void> {
  const input = page.getByPlaceholder(ph).first();
  await input.click();
  await input.fill(term);
  const listboxId = await input.getAttribute('aria-controls');
  const o = page.locator(`#${listboxId} [role="option"]`).filter({ hasText: opt }).first();
  await expect(o, `option ${opt}`).toBeVisible({ timeout: 30_000 });
  await o.click();
  await page.waitForTimeout(600);
}

async function codeOnPage(page: Page, re: RegExp): Promise<string> {
  return ((await page.locator('body').innerText()).match(re) ?? [''])[0];
}

async function bannerText(page: Page): Promise<string> {
  for (const loc of [page.locator('.bomx-alert-red'), page.locator('[style*="rgba(239"]')]) {
    const n = Math.min(await loc.count(), 12);
    for (let i = 0; i < n; i++) {
      if (!(await loc.nth(i).isVisible().catch(() => false))) continue;
      const t = (await loc.nth(i).innerText().catch(() => '')).trim();
      if (t.length > 8 && !/^Cancel$/i.test(t)) return t.replace(/\s+/g, ' ');
    }
  }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────

test('@bom3 01 — BOM with one child of each type', async ({ page }) => {
  if (state.bomNo) {
    record({ step: '01', doc: 'BOM', code: state.bomNo, qty: '—', status: 'reused', note: 'E2E_BOM3' });
    return;
  }
  await page.goto('/bom-masters/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.bomNo = await page.locator('input[value^="BOM-"]').first().inputValue().catch(() => '');

  await page.getByPlaceholder(/Hydraulic Press Assembly/i).fill(`${TAG} three types`);

  await pickInto(page, 'bom-parent-item', PARENT);
  const parentName = page.getByPlaceholder('auto-filled').first();
  await expect(parentName).toHaveValue(PARENT_NAME, { timeout: 15_000 });

  const addChild = page.getByRole('button', { name: /Add child item/i });
  for (const [idx, c] of CHILDREN.entries()) {
    await addChild.click();
    await page.waitForTimeout(600);
    await pickInto(page, `bom-item-${idx}`, c.code);

    // Name auto-fills — nth(idx+1) because nth(0) is the parent's box.
    await expect(page.getByPlaceholder('auto-filled').nth(idx + 1)).toHaveValue(c.name, {
      timeout: 15_000,
    });

    const row = page.locator('.bomx-row').nth(idx + 1); // nth(0) is the header row
    await row.locator('input[type="number"]').fill(String(c.qtyPerSet));

    // ELEMENT: the Type select offers exactly the three line types.
    const typeSel = row.locator('select');
    const opts = await typeSel.locator('option').allInnerTexts();
    if (idx === 0) {
      // eslint-disable-next-line no-console
      console.log(`>> Type options: ${opts.join(' | ')}`);
      expect(opts.map((o) => o.trim())).toEqual(['Manufacture', 'Purchase', 'Outsource']);
    }
    await typeSel.selectOption(c.type);
    await expect(typeSel).toHaveValue(c.type);
    await page.waitForTimeout(300);
  }

  await expect(page.getByText(`${CHILDREN.length} of ${CHILDREN.length} lines filled`)).toBeVisible();

  await page.getByRole('button', { name: /Save BOM/i }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  expect(page.url(), `BOM save rejected: ${err}`).not.toContain('/bom-masters/new');
  if (!state.bomNo) state.bomNo = await codeOnPage(page, /BOM-\d+/);

  // Persistence proof + the saved types read back.
  const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  for (const c of CHILDREN) {
    expect(detail, `${c.code} saved on the BOM`).toContain(c.code);
  }
  // eslint-disable-next-line no-console
  console.log(`>> saved BOM detail mentions: ${CHILDREN.map((c) => c.code).join(', ')}`);

  record({
    step: '01',
    doc: 'BOM',
    code: state.bomNo,
    qty: CHILDREN.map((c) => `${c.qtyPerSet}/set`).join(' · '),
    status: 'active',
    note: `parent ${PARENT} · ${CHILDREN.map((c) => `${c.code} ${c.type}`).join(' · ')}`,
  });
});

test('@bom3 02 — equipment SO, BOM attaches itself', async ({ page }) => {
  if (state.soCode) {
    record({ step: '02', doc: 'SO', code: state.soCode, qty: `${SO_QTY}`, status: 'reused', note: 'E2E_SO3' });
    return;
  }
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.soCode = await page.locator('input[value^="IN-SO-"]').first().inputValue().catch(() => '');

  // Type first — switching it re-renders the form and would wipe a client
  // picked before it.
  await page.locator('select.innovic-select').first().selectOption('equipment');
  await page.waitForTimeout(2500);

  await pickByPlaceholder(page, /Type client code or name/i, CLIENT_CODE, CLIENT_MATCH);
  await page.getByPlaceholder(/Client PO reference/i).fill(TAG);

  await page.locator('input[name="lines.0.itemCodeText"]').fill(PARENT);
  await page.waitForTimeout(2500);

  const note = page.locator('text=/attached automatically for/');
  await expect(note, 'the parent finds its own BOM').toBeVisible({ timeout: 20_000 });
  const noteText = ((await note.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-console
  console.log(`>> ${noteText}`);
  expect(noteText).toContain(state.bomNo);
  expect(noteText, 'all three children counted').toContain('3 parts');

  const nums = page.locator('input[type="number"]:visible');
  await nums.nth(0).fill(String(SO_QTY));
  await nums.nth(1).fill(String(RATE)).catch(() => {});
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Save SO/i }).click();
  await page.waitForTimeout(6000);
  const err = await bannerText(page);
  expect(page.url(), `SO save rejected: ${err}`).toMatch(/sales-orders\/[0-9a-f]{8}-/);
  if (!state.soCode) state.soCode = await codeOnPage(page, /IN-SO-\d+/);

  record({
    step: '02',
    doc: 'Sales Order (equipment)',
    code: state.soCode,
    qty: `${SO_QTY} units @ ₹${RATE}`,
    status: 'open',
    note: `${PARENT} · BOM ${state.bomNo} (3 parts)`,
  });
});

test('@bom3 03 — explode: what does each TYPE spawn?', async ({ page }) => {
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.soCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.soCode).first().click();
  await page.waitForTimeout(2500);

  const bomBtn = page.getByRole('button', { name: /BOM Planning/i }).first();
  if ((await bomBtn.count()) === 0) {
    record({ step: '03', doc: 'BOM explosion', code: '—', qty: '—', status: 'NOT OFFERED', note: 'no BOM Planning button' });
    return;
  }
  await bomBtn.click();
  await page.waitForTimeout(3000);

  // Each child's Total Need = qty/set × order qty.
  const modal = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  for (const c of CHILDREN) {
    const need = c.qtyPerSet * SO_QTY;
    // eslint-disable-next-line no-console
    console.log(`>> ${c.code} (${c.type}) needs ${c.qtyPerSet}/set × ${SO_QTY} = ${need}; modal shows the code: ${modal.includes(c.code)}`);
    expect(modal, `${c.code} listed in the explosion`).toContain(c.code);
  }

  const boxes = page.locator('table input[type="checkbox"]:not([disabled])');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  // A row whose stock already covers the need arrives at qty 0 and is skipped
  // by the same guard as an unticked one. Give it the FULL need — planning 1
  // when 6 are needed would quietly under-plan and make the later readiness
  // numbers meaningless.
  const qtys = page.locator('table input[type="number"]:not([disabled])');
  for (let i = 0; i < (await qtys.count()); i++) {
    if (Number(await qtys.nth(i).inputValue()) <= 0) {
      const need = (CHILDREN[i]?.qtyPerSet ?? 1) * SO_QTY;
      await qtys.nth(i).fill(String(need));
    }
  }
  // eslint-disable-next-line no-console
  console.log(`>> ticked ${n} plannable row(s)`);

  // Buy and Outsource children cannot be planned without a vendor — a row for
  // each appears once it is ticked. Fill them, or the save is refused.
  await page.waitForTimeout(800);
  for (const c of CHILDREN) {
    if (c.type === 'manufacture') continue;
    const picker = page.locator(`#bomplan-vendor-${c.code}`);
    if ((await picker.count()) === 0) {
      // eslint-disable-next-line no-console
      console.log(`>> no vendor picker for ${c.code} (${c.type}) — already planned?`);
      continue;
    }
    await picker.click();
    await page.waitForTimeout(1200);
    const opt = page.locator(`#bomplan-vendor-${c.code}-listbox [role="option"]`).first();
    await expect(opt, `a vendor to pick for ${c.code}`).toBeVisible({ timeout: 20_000 });
    const vendorText = ((await opt.textContent()) ?? '').trim();
    await opt.click();
    await page.waitForTimeout(500);
    // eslint-disable-next-line no-console
    console.log(`>> ${c.code} (${c.type}) → vendor ${vendorText}`);
  }

  await page.getByRole('button', { name: /Create|Plan/i }).last().click();
  await page.waitForTimeout(6000);
  const err = await bannerText(page);
  if (err) {
    // eslint-disable-next-line no-console
    console.log(`>> planning said: "${err}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const after = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  state.planCodes = [...new Set(after.match(/PLN-\d+/g) ?? [])];
  // eslint-disable-next-line no-console
  console.log(`>> plans on the SO: ${state.planCodes.join(', ') || '(none)'}`);

  // What kind of plan did each type become? The page prints the plan kind next
  // to each row ("Buy", "OSP", "Make"/manufacture).
  for (const c of CHILDREN) {
    const idx = after.indexOf(c.code);
    const around = idx >= 0 ? after.slice(Math.max(0, idx - 90), idx + 130) : '(not on the page)';
    // eslint-disable-next-line no-console
    console.log(`>> ${c.type.padEnd(11)} ${c.code}: ${around}`);
  }

  record({
    step: '03',
    doc: 'BOM child plans',
    code: state.planCodes.join(', ') || '—',
    qty: CHILDREN.map((c) => `${c.code}:${c.qtyPerSet * SO_QTY}`).join(' · '),
    status: state.planCodes.length > 0 ? `${state.planCodes.length} created` : 'BLOCKED',
    note: state.planCodes.length > 0 ? 'one per child' : `refused: ${err}`,
  });
});

test('@bom3 04 — how far can the assembly get?', async ({ page }) => {
  await page.goto('/customer-dispatches/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const sels = page.locator('select');
  let picked = false;
  for (let s = 0; s < (await sels.count()); s++) {
    const opts = await sels.nth(s).locator('option').allInnerTexts();
    const idx = opts.findIndex((t) => t.includes(state.soCode));
    if (idx >= 0) {
      await sels.nth(s).selectOption({ index: idx });
      picked = true;
      break;
    }
  }
  if (!picked) {
    record({ step: '04', doc: 'Dispatch', code: '—', qty: `${SO_QTY}`, status: 'BLOCKED', note: `${state.soCode} not offered` });
    return;
  }
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Add Line/i }).click();
  await page.waitForTimeout(1500);

  const combo = page.locator('input[role="combobox"]').last();
  await combo.click();
  await page.waitForTimeout(1500);
  const opt = page.locator('[role="listbox"] [role="option"]').first();
  if ((await opt.count()) > 0) await opt.click();
  await page.waitForTimeout(1500);

  const row = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const dqty = page.locator('input[type="number"]').last();
  const max = await dqty.getAttribute('max').catch(() => null);
  // eslint-disable-next-line no-console
  console.log(`>> dispatch cap for the assembly: ${max ?? '(none)'}`);

  // Ready is the WEAKEST component: nothing has been produced or received
  // against this SO yet, so 0 is the correct answer, not a failure.
  const readyIdx = row.indexOf('ORDER');
  record({
    step: '04',
    doc: 'Customer Dispatch',
    code: '—',
    qty: `cap ${max ?? 'n/a'}`,
    status: max === '0' || !(await dqty.isEnabled()) ? 'BLOCKED (correct)' : 'open',
    note:
      max === '0'
        ? 'weakest component rules: no child produced/received yet, so 0 assemblies are shippable'
        : row.slice(readyIdx > 0 ? readyIdx : 0, 260),
  });
});

test('@bom3 99 — report', async () => {
  const w = [4, 26, 26, 34, 20];
  const line = (c: string[]): string =>
    '| ' + c.map((s, i) => s.padEnd(w[i] ?? 20)).join(' | ') + ' |';
  // eslint-disable-next-line no-console
  console.log('\n\n===== BOM WITH ALL THREE LINE TYPES =====');
  // eslint-disable-next-line no-console
  console.log(line(['#', 'Document', 'Code', 'Qty', 'Status']));
  for (const r of REPORT) {
    // eslint-disable-next-line no-console
    console.log(line([r.step, r.doc, r.code, r.qty, r.status]));
    // eslint-disable-next-line no-console
    if (r.note) console.log(`     ↳ ${r.note}`);
  }
  // eslint-disable-next-line no-console
  console.log('=========================================\n');
  expect(REPORT.length).toBeGreaterThan(2);
});
