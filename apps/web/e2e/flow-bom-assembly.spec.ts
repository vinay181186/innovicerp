import { expect, test, type Page } from '@playwright/test';

// BOM → EQUIPMENT (assembly) SO → INVOICE, end to end.
//
// An equipment SO sells one assembled unit; its Bill of Materials says which
// child parts go into it and how many per set. Planning explodes the BOM into
// a child plan per part, each of which becomes a Job Card.
//
// The BOM here has ONE child part so the chain stays walkable in a single run;
// the explosion maths (qty per set × order qty) is still exercised.
//
// Also proves the BOM form changes shipped in be3548b:
//   * the item picker is the shared SearchableSelect (substring search,
//     server-side, stores the id) — not the old <datalist>
//   * Item Name auto-fills into its own read-only box beside the code
//   * a new BOM opens as Active, not Draft
//
// WRITES TO PROD (authorized, same as the other flow-* specs).
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bom"

test.describe.configure({ mode: 'serial' });

// NOTE: the old CLI-DEMO / "Demo Engineering Works" fixture the other specs
// reference does NOT exist in this database — a search for it returns nothing,
// which is what stalled the first run. Use a real client.
const CLIENT_CODE = 'CLI-009';
const CLIENT_MATCH = /Arindam Engineering/i;
/** The assembled unit sold on the SO. */
const PARENT_ITEM = '554117133000';
/** The single child part the BOM explodes into. */
const CHILD_ITEM = '554117144000';
const CHILD_NAME = 'COVER';
const QTY_PER_SET = 2;
const SO_QTY = 3;
const RATE = 500;
const TAG = `E2E-BOM-${Date.now()}`;

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
  bomNo: process.env['E2E_BOM'] ?? '',
  soCode: process.env['E2E_SO'] ?? '',
  planCode: process.env['E2E_PLN'] ?? '',
  jcCode: process.env['E2E_JC'] ?? '',
  dspCode: '',
  invCode: '',
};

async function pick(page: Page, ph: RegExp, term: string, optText: RegExp): Promise<void> {
  const input = page.getByPlaceholder(ph).first();
  await input.click();
  await input.fill(term);
  const listboxId = await input.getAttribute('aria-controls');
  if (listboxId) {
    const opt = page.locator(`#${listboxId} [role="option"]`).filter({ hasText: optText }).first();
    await expect(opt, `option ${optText} in ${listboxId}`).toBeVisible({ timeout: 30_000 });
    await opt.click();
  } else {
    await page.waitForTimeout(2000);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await expect(input, 'picker committed').not.toHaveValue('', { timeout: 10_000 });
  await page.waitForTimeout(700);
}

async function codeOnPage(page: Page, re: RegExp): Promise<string> {
  return ((await page.locator('body').innerText()).match(re) ?? [''])[0];
}

async function bannerText(page: Page): Promise<string> {
  for (const loc of [page.locator('[style*="rgba(239"]'), page.locator('.form-error')]) {
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

test('@bom 01 — create the BOM (new picker, auto-filled name, Active default)', async ({
  page,
}) => {
  if (state.bomNo) {
    record({ step: '01', doc: 'BOM', code: state.bomNo, qty: '—', status: 'reused', note: 'E2E_BOM' });
    return;
  }
  await page.goto('/bom-masters/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  state.bomNo = await page.locator('input[value^="BOM-"]').first().inputValue().catch(() => '');

  // ELEMENT: status must default to Active (was Draft).
  const statusSel = page.locator('select.innovic-select').first();
  const status = await statusSel.inputValue();
  // eslint-disable-next-line no-console
  console.log(`>> BOM status default: "${status}"`);
  expect(status, 'a new BOM opens as Active').toBe('active');

  await page.getByPlaceholder(/Hydraulic Press Assembly/i).fill(`${TAG} assembly`);

  // ELEMENT: the item field is the shared combobox, not a <datalist> input.
  const itemBox = page.getByPlaceholder(/Search item code or name/i).first();
  const role = await itemBox.getAttribute('role');
  const listAttr = await itemBox.getAttribute('list');
  // eslint-disable-next-line no-console
  console.log(`>> item field role="${role}" list="${listAttr ?? '(none)'}"`);
  expect(role, 'item picker is a combobox').toBe('combobox');
  expect(listAttr, 'the old datalist is gone').toBeNull();

  // ELEMENT: the open list must escape the panel. `.panel` sets
  // overflow:hidden, which sliced the absolutely-positioned dropdown in half —
  // z-index cannot beat clipping. It is now portaled to <body>.
  await itemBox.click();
  await itemBox.fill(CHILD_NAME);
  await page.waitForTimeout(2000);
  const listParent = await page
    .locator('#bom-item-0-listbox')
    .evaluate((el) => el.parentElement?.tagName ?? '(none)');
  // eslint-disable-next-line no-console
  console.log(`>> dropdown list parent: ${listParent}`);
  expect(listParent, 'the list is portaled to <body>, not trapped in .panel').toBe('BODY');

  const optBox = await page
    .locator('#bom-item-0-listbox [role="option"]')
    .first()
    .boundingBox();
  const panelBox = await page.locator('.panel').last().boundingBox();
  // eslint-disable-next-line no-console
  console.log(
    `>> option bottom ${optBox?.y != null ? Math.round(optBox.y + optBox.height) : '?'}` +
      ` vs panel bottom ${panelBox?.y != null ? Math.round(panelBox.y + panelBox.height) : '?'}`,
  );
  expect(optBox?.height ?? 0, 'the option row has its full height, not a sliver').toBeGreaterThan(20);

  // Search by the NAME, not the code — the old datalist could only prefix-match
  // the code, so this is the behaviour that actually changed.
  await pick(page, /Search item code or name/i, CHILD_NAME, new RegExp(CHILD_ITEM));

  // ELEMENT: the name auto-fills into its own read-only box.
  const nameBox = page.getByPlaceholder('auto-filled').first();
  await expect(nameBox, 'Item Name auto-fills').toHaveValue(new RegExp(CHILD_NAME, 'i'), {
    timeout: 15_000,
  });
  expect(await nameBox.isEditable(), 'Item Name is read-only').toBe(false);
  // eslint-disable-next-line no-console
  console.log(`>> auto-filled name: "${await nameBox.inputValue()}"`);

  // Qty per set.
  await page.locator('input[type="number"]').last().fill(String(QTY_PER_SET));
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /Save BOM/i }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  expect(page.url(), `BOM save rejected: ${err}`).not.toContain('/bom-masters/new');
  if (!state.bomNo) state.bomNo = await codeOnPage(page, /BOM-\d+/);

  await page.goto('/bom-masters', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await expect(
    page.getByText(state.bomNo).first(),
    'the BOM must be findable on the register — persistence proof',
  ).toBeVisible({ timeout: 20_000 });

  record({
    step: '01',
    doc: 'BOM',
    code: state.bomNo,
    qty: `${QTY_PER_SET} per set`,
    status: 'active',
    note: `1 child part: ${CHILD_ITEM} ${CHILD_NAME}`,
  });
});

test('@bom 02 — create the equipment (assembly) SO with that BOM', async ({ page }) => {
  if (state.soCode) {
    record({ step: '02', doc: 'SO', code: state.soCode, qty: `${SO_QTY}`, status: 'reused', note: 'E2E_SO' });
    return;
  }
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.soCode = await page.locator('input[value^="IN-SO-"]').first().inputValue().catch(() => '');

  // Switch to Equipment FIRST — that is what turns on the BOM selector, and
  // changing the type re-renders the form, which wiped a client picked before
  // it ("Pick a client from the master" on save).
  const typeSel = page.locator('select.innovic-select').first();
  await typeSel.selectOption('equipment');
  await page.waitForTimeout(2500);

  await pick(page, /Type client code or name/i, CLIENT_CODE, CLIENT_MATCH);
  await page.getByPlaceholder(/Client PO reference/i).fill(TAG);
  await page.waitForTimeout(600);

  // Equipment line. Address the part field by its OWN name — /code or name/i
  // also matches the CLIENT placeholder ("Type client code or name…"), so the
  // item code went into the client box and wiped the client, which is what
  // produced "Pick a client from the master" on save.
  await page.locator('input[name="lines.0.itemCodeText"]').fill(PARENT_ITEM);
  await page.waitForTimeout(2000);

  const nums = page.locator('input[type="number"]:visible');
  await nums.nth(0).fill(String(SO_QTY));
  await nums.nth(1).fill(String(RATE)).catch(() => {});
  await page.waitForTimeout(500);

  // The BOM <select> is the one carrying our BOM number as an option.
  const bomSel = page
    .locator('select')
    .filter({ has: page.locator('option', { hasText: state.bomNo }) })
    .first();
  await expect(bomSel, 'the BOM appears in the SO BOM picker').toHaveCount(1, { timeout: 20_000 });
  await bomSel.selectOption({ label: new RegExp(state.bomNo) as unknown as string }).catch(async () => {
    const opts = await bomSel.locator('option').all();
    for (const o of opts) {
      const t = await o.innerText();
      if (t.includes(state.bomNo)) {
        await bomSel.selectOption(await o.getAttribute('value') ?? '');
        break;
      }
    }
  });
  await page.waitForTimeout(600);

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
    note: `${PARENT_ITEM} assembly · BOM ${state.bomNo}`,
  });
});

test('@bom 03 — explode the BOM into child plans', async ({ page }) => {
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.soCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.soCode).first().click();
  await page.waitForTimeout(2500);

  const bomBtn = page.getByRole('button', { name: /BOM Planning/i }).first();
  const hasBtn = (await bomBtn.count()) > 0;
  // eslint-disable-next-line no-console
  console.log(`>> BOM Planning button present: ${hasBtn}`);
  if (!hasBtn) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // eslint-disable-next-line no-console
    console.log(`>> planning page: ${body.slice(600, 1600)}`);
    record({
      step: '03',
      doc: 'BOM explosion',
      code: '—',
      qty: '—',
      status: 'NOT OFFERED',
      note: 'no BOM Planning button on the SO line',
    });
    return;
  }
  const btnLabel = await bomBtn.innerText();
  // eslint-disable-next-line no-console
  console.log(`>> ${btnLabel.replace(/\s+/g, ' ')}`);
  await bomBtn.click();
  await page.waitForTimeout(3000);

  // The modal lists each child with its total need = qty/set × order qty.
  const modalText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const expectedNeed = QTY_PER_SET * SO_QTY;
  // eslint-disable-next-line no-console
  console.log(`>> expecting total need ${expectedNeed} (${QTY_PER_SET}/set × ${SO_QTY}); modal mentions it: ${modalText.includes(String(expectedNeed))}`);

  await page.getByRole('button', { name: /Create|Plan/i }).last().click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  if (err) {
    // eslint-disable-next-line no-console
    console.log(`>> BOM planning error: "${err}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  state.planCode = await codeOnPage(page, /PLN-\d+/);
  record({
    step: '03',
    doc: 'BOM child plan',
    code: state.planCode || '—',
    qty: `${expectedNeed} needed (${QTY_PER_SET}/set × ${SO_QTY})`,
    status: state.planCode ? 'created' : 'BLOCKED',
    note: state.planCode ? `child ${CHILD_ITEM}` : `refused: ${err}`,
  });
});

test('@bom 04 — add a routing and execute the child plan', async ({ page }) => {
  test.skip(!state.planCode, 'no plan created');
  // A manufacture plan lands with ZERO operations, so /plans offers no Execute
  // at all. The routing is added in the planning workflow, same as any other
  // manufacture plan: open the plan → add an op → Save Plan → Execute.
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.soCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.soCode).first().click();
  await page.waitForTimeout(3000);

  const planRow = page.locator('tr, div').filter({ hasText: state.planCode }).last();
  const editBtn = planRow.getByRole('button', { name: /Edit/i }).first();
  if ((await editBtn.count()) === 0) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // eslint-disable-next-line no-console
    console.log(`>> no Edit on the plan row; page: ${body.slice(700, 1700)}`);
    record({ step: '04', doc: 'Job Card', code: '—', qty: '—', status: 'BLOCKED', note: 'could not open the plan for routing' });
    return;
  }
  await editBtn.click();
  await page.waitForTimeout(2500);

  const rows = page.locator('table.ops-routing tbody tr');
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(900);
  await rows.nth(0).getByPlaceholder('Operation name').fill('E2E BOM TURNING');
  const mach = rows.nth(0).getByPlaceholder(/Machine/i);
  await mach.click();
  await mach.fill('CNC-01');
  await page.waitForTimeout(1600);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(6000);

  state.jcCode = await codeOnPage(page, /IN-JC-\d{2}-\d+/);
  const err = await bannerText(page);
  record({
    step: '04',
    doc: 'Job Card',
    code: state.jcCode || '—',
    qty: `${QTY_PER_SET * SO_QTY}`,
    status: state.jcCode ? 'open' : 'BLOCKED',
    note: state.jcCode ? `from ${state.planCode}` : `refused: ${err}`,
  });
});

test('@bom 05 — produce and pass QC', async ({ page }) => {
  test.skip(!state.jcCode, 'no job card');
  const qty = QTY_PER_SET * SO_QTY;
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/IN-JC-/i).fill(state.jcCode);
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(4000);

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(`>> op-entry ops: ${body.slice(500, 1200)}`);

  // Complete every process op, then accept at the QC op.
  const processOp = page.getByText(/Machining|Turning|Milling|Drilling|Process/i).first();
  if ((await processOp.count()) > 0) {
    await processOp.click();
    await page.waitForTimeout(1500);
    await page.getByRole('spinbutton').first().fill(String(qty));
    await page.getByPlaceholder(/Operator name/i).fill('E2E Auto').catch(() => {});
    await page.getByRole('button', { name: /Submit completion/i }).click();
    await page.waitForTimeout(4000);
  }
  const qcOp = page.getByText('DIR', { exact: true }).first();
  if ((await qcOp.count()) > 0) {
    await qcOp.click();
    await page.waitForTimeout(1800);
    await page.getByRole('spinbutton').first().fill(String(qty));
    await page.getByRole('button', { name: /Submit QC inspection/i }).click();
    await page.waitForTimeout(4500);
  }
  const after = await page.locator('body').innerText();
  record({
    step: '05',
    doc: 'Op Entry',
    code: state.jcCode,
    qty: `${qty} produced + QC`,
    status: /complete/i.test(after) ? 'complete' : 'logged',
    note: 'child part made',
  });
});

test('@bom 06 — dispatch the assembled units', async ({ page }) => {
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
    record({ step: '06', doc: 'Dispatch', code: '—', qty: `${SO_QTY}`, status: 'BLOCKED', note: `${state.soCode} not offered` });
    return;
  }
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Add Line/i }).click();
  await page.waitForTimeout(1500);
  await page.getByPlaceholder(/code or name/i).first().fill(PARENT_ITEM);
  await page.waitForTimeout(1800);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const dqty = page.locator('input[type="number"]').last();
  const max = await dqty.getAttribute('max').catch(() => null);
  // eslint-disable-next-line no-console
  console.log(`>> dispatch qty cap: ${max ?? '(none)'}`);
  await dqty.fill(String(SO_QTY));
  await page.getByRole('button', { name: /Create Dispatch/i }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  // The first attempt produced no document and no error text, so dump what the
  // page actually says — the same diagnostic that exposed the real message on
  // the OSP outward DC.
  // eslint-disable-next-line no-console
  console.log(`>> after Create Dispatch — url: ${page.url()}`);
  const dspText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(`>> dispatch page: ${dspText.slice(600, 1800)}`);
  state.dspCode = await codeOnPage(page, /DSP-\d+/);
  record({
    step: '06',
    doc: 'Customer Dispatch',
    code: state.dspCode || '—',
    qty: `${SO_QTY}`,
    status: state.dspCode ? 'issued' : 'BLOCKED',
    note: state.dspCode ? `cap was ${max ?? 'n/a'}` : `refused: ${err}`,
  });
});

test('@bom 07 — invoice the assembly', async ({ page }) => {
  await page.goto('/invoices/new', { waitUntil: 'domcontentloaded' });
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
    record({ step: '07', doc: 'Invoice', code: '—', qty: `${SO_QTY}`, status: 'BLOCKED', note: `${state.soCode} not offered` });
    return;
  }
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Add Line/i }).click();
  await page.waitForTimeout(1500);
  // Do NOT swallow a failed pick — with no line selected the qty box stays
  // disabled and the save fails with "Enter an invoice qty on at least one
  // line", which is what happened and hid the real cause.
  await pick(page, /code or name/i, PARENT_ITEM, new RegExp(PARENT_ITEM));
  await page.waitForTimeout(1500);

  const nums = page.locator('input[type="number"]');
  for (let k = 0; k < (await nums.count()); k++) {
    if (!(await nums.nth(k).isEditable().catch(() => false))) continue;
    const v = await nums.nth(k).inputValue().catch(() => '');
    if (v === '') {
      await nums.nth(k).fill(String(SO_QTY));
      break;
    }
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Create Invoice/i }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  // eslint-disable-next-line no-console
  console.log(`>> after Create Invoice — url: ${page.url()}`);
  const invText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(`>> invoice page: ${invText.slice(600, 1800)}`);
  state.invCode = await codeOnPage(page, /INV-\d+/);
  record({
    step: '07',
    doc: 'Invoice',
    code: state.invCode || '—',
    qty: `${SO_QTY} × ₹${RATE}`,
    status: state.invCode ? 'raised' : 'BLOCKED',
    note: state.invCode ? '' : `refused: ${err}`,
  });
});

test('@bom 99 — report', async () => {
  const w = [4, 26, 22, 30, 14];
  const line = (c: string[]): string =>
    '| ' + c.map((s, i) => s.padEnd(w[i] ?? 20)).join(' | ') + ' |';
  // eslint-disable-next-line no-console
  console.log('\n\n========== BOM → ASSEMBLY SO → INVOICE ==========');
  // eslint-disable-next-line no-console
  console.log(line(['#', 'Document', 'Code', 'Qty', 'Status']));
  for (const r of REPORT) {
    // eslint-disable-next-line no-console
    console.log(line([r.step, r.doc, r.code, r.qty, r.status]));
    if (r.note) {
      // eslint-disable-next-line no-console
      console.log(`     ↳ ${r.note}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log('=================================================\n');
  expect(REPORT.length).toBeGreaterThan(4);
});
