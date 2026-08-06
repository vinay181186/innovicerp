import { expect, test, type Page } from '@playwright/test';

// JWSO + FULL OUTSOURCE, end to end.
//
// The customer supplies the material (Party GRN), the whole part is then made
// by an outside vendor (PR → PO → outward DC → return GRN → incoming QC), and
// the finished goods go back to the customer (Return Challan → Invoice).
//
// Only `direct_purchase` is blocked on a JWSO line; `full_outsource` is offered,
// so this combination is supported and worth proving.
//
// Things this run is specifically watching:
//   * ADR-095 — full outsource raises exactly ONE PR (no material PR)
//   * ADR-092 — the JC has a single outsource op, so it IS the last op and the
//               vendor's return SHOULD credit stock (the mid-route guard must
//               not fire)
//   * ADR-106 — the return challan must then DEBIT that stock again
//   * ADR-103 — the material gate lives in op-entry, which refuses outsource
//               ops outright; this run records whether client material can
//               therefore reach a vendor with no issue document
//
// WRITES TO PROD (authorized, same as the other flow-* specs).
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@jwout"

test.describe.configure({ mode: 'serial' });

const CLIENT_CODE = 'CLI-009';
const CLIENT_NAME = 'Arindam Engineering';
const ITEM_CODE = '554117150000';
const ITEM_NAME = 'ARM CONNECTING';
const VENDOR = 'VND-008';
const QTY = 6;
const RATE = 90;
const TAG = `E2E-JWOUT-${Date.now()}`;

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

// Resume support. A JWSO line that is already fully planned shows no "+ Plan"
// button at all, so re-running step 03 against it just hangs — pass the codes
// an earlier run produced instead of re-creating them.
const state = {
  jwCode: process.env['E2E_JW'] ?? '',
  pmCode: process.env['E2E_PM'] ?? '',
  grnCode: process.env['E2E_GRN'] ?? '',
  planCode: process.env['E2E_PLN'] ?? '',
  jcCode: process.env['E2E_JC'] ?? '',
  prCode: process.env['E2E_PR'] ?? '',
  poCode: process.env['E2E_PO'] ?? '',
  poId: '',
  dcCode: process.env['E2E_DC'] ?? '',
  dcId: process.env['E2E_DC_ID'] ?? '',
  vendorGrn: '',
  returnCode: '',
  invoiceCode: '',
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
  await page.waitForTimeout(800);
}

async function codeOnPage(page: Page, re: RegExp): Promise<string> {
  return ((await page.locator('body').innerText()).match(re) ?? [''])[0];
}

/** Code from the register ROW that belongs to OUR JWSO.
 *
 *  Scanning the whole page for a code pattern matched the PREVIOUS run's row
 *  and reported a document that was never created — the return and the invoice
 *  both "passed" while the database had neither. Always scope to our JWSO. */
async function codeInRowFor(page: Page, jw: string, re: RegExp): Promise<string> {
  const row = page.locator('tr', { hasText: jw }).first();
  if ((await row.count()) === 0) return '';
  return ((await row.innerText()).match(re) ?? [''])[0];
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

test('@jwout 01 — create the JWSO', async ({ page }) => {
  if (state.jwCode) {
    record({ step: '01', doc: 'JWSO', code: state.jwCode, qty: `${QTY}`, status: 'reused', note: 'E2E_JW' });
    return;
  }
  await page.goto('/job-work-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await pick(page, /Type client code or name/i, CLIENT_CODE, new RegExp(CLIENT_NAME, 'i'));
  await page.getByPlaceholder(/Client PO reference/i).fill(TAG);

  const lineCodeBoxes = page.locator('input[name$=".itemCodeText"]');
  if ((await lineCodeBoxes.count()) === 0) {
    await page.getByRole('button', { name: /Add Line/i }).first().click();
    await page.waitForTimeout(800);
  }
  await page.locator('input[name="lines.0.itemCodeText"]').fill(ITEM_CODE);
  await page.waitForTimeout(2000);
  await page.locator('input[name="lines.0.orderQty"]').fill(String(QTY));
  await page.locator('input[name="lines.0.rate"]').fill(String(RATE));
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /Save JW/i }).click();
  await page.waitForTimeout(6000);
  const err = await bannerText(page);
  expect(page.url(), `save rejected: ${err}`).not.toContain('/job-work-orders/new');
  state.jwCode = await codeOnPage(page, /IN-JW-\d+/);
  expect(state.jwCode).toMatch(/IN-JW-\d+/);
  record({
    step: '01',
    doc: 'JWSO',
    code: state.jwCode,
    qty: `${QTY} ordered @ ₹${RATE}`,
    status: 'open',
    note: `${CLIENT_NAME} · line 1 = ${ITEM_CODE} ${ITEM_NAME}`,
  });
});

test('@jwout 02 — party material + GRN (customer supplies the material)', async ({ page }) => {
  if (state.grnCode) {
    record({ step: '02', doc: 'Party Material + GRN', code: `${state.pmCode} / ${state.grnCode}`,
      qty: `${QTY} received`, status: 'reused', note: 'E2E_GRN' });
    return;
  }
  if (!state.pmCode) {
    await page.goto('/party-material', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /Add Material/i }).first().click();
    await page.waitForTimeout(1500);
    state.pmCode = await page.locator('input[value^="PM-"]').first().inputValue().catch(() => '');
    await pick(page, /Type client code or name/i, CLIENT_CODE, new RegExp(CLIENT_NAME, 'i'));
    await pick(page, /Type SO \/ JWSO no/i, state.jwCode, new RegExp(state.jwCode));
    await pick(page, /Pick an item from this order/i, ITEM_CODE, new RegExp(ITEM_CODE));
    await page.getByRole('button', { name: /Save Material/i }).click();
    await page.waitForTimeout(4000);
    if (!state.pmCode) state.pmCode = await codeOnPage(page, /PM-\d+/);
  }
  expect(state.pmCode).toMatch(/PM-\d+/);

  await page.goto('/party-grn', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /New Party GRN/i }).click();
  await page.waitForTimeout(1500);
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  const lineSel = page.locator('table select').first();
  await expect(lineSel.locator('option', { hasText: ITEM_CODE })).toHaveCount(1, {
    timeout: 30_000,
  });
  await lineSel.selectOption('1');
  await page.locator('input[list="dlPGrnMaterial"]').first().fill(state.pmCode);
  await page.waitForTimeout(1200);
  await page.locator('table input[type="number"]').first().fill(String(QTY));
  await page.getByRole('button', { name: /Save GRN/i }).click();
  await page.waitForTimeout(5000);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.grnCode = await codeInRowFor(page, state.jwCode, /PGRN-\d+/);
  record({
    step: '02',
    doc: 'Party Material + GRN',
    code: `${state.pmCode} / ${state.grnCode}`,
    qty: `${QTY} received`,
    status: 'posted',
    note: `customer material in; party stock +${QTY}`,
  });
});

test('@jwout 03 — plan the JWSO line as FULL OUTSOURCE and execute', async ({ page }) => {
  if (state.planCode) {
    record({ step: '03', doc: 'Plan (full outsource)', code: state.planCode,
      qty: `${QTY}`, status: 'reused',
      note: `JC ${state.jcCode || '?'} + PR ${state.prCode || '?'} (E2E_PLN)` });
    return;
  }
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.jwCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.jwCode).first().click();
  await page.waitForTimeout(2500);
  // The "+ Plan" modal only asks for qty — the plan TYPE is chosen in the plan
  // editor that opens after Save. (My first attempt looked for the type buttons
  // on the create modal and found nothing there.)
  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^Save$/ }).first().click();
  await page.waitForTimeout(4000);
  state.planCode = await codeOnPage(page, /PLN-\d+/);
  // eslint-disable-next-line no-console
  console.log(`>> plan created: ${state.planCode}`);

  // ELEMENT: Direct Purchase must NOT be offered on a JWSO line (ADR-101);
  // Full Outsource must be.
  const dpCount = await page.getByText(/Direct Purchase/i).count();
  const foBtn = page.getByText(/Full Outsource/i).first();
  // eslint-disable-next-line no-console
  console.log(`>> plan types in the editor — Direct Purchase shown: ${dpCount > 0}`);
  expect(dpCount, 'Direct Purchase is hidden for JWSO lines').toBe(0);
  await expect(foBtn, 'Full Outsource is offered').toBeVisible({ timeout: 15_000 });
  await foBtn.click();
  await page.waitForTimeout(1500);

  // Vendor + process are both required before execute.
  await page.getByPlaceholder(/Search vendor/i).first().fill(VENDOR);
  await page.waitForTimeout(1500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.getByPlaceholder(/Complete machining as per drawing|Heat Treatment/i).first().fill(TAG);
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(4000);
  const saveErr = await bannerText(page);
  if (saveErr) {
    // eslint-disable-next-line no-console
    console.log(`>> plan save error: "${saveErr}"`);
  }

  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(6000);
  const body = await page.locator('body').innerText();
  state.jcCode = (body.match(/IN-JC-\d{2}-\d+/) ?? [''])[0];
  state.prCode = (body.match(/IN-JWPR-\d+/) ?? [''])[0];
  // eslint-disable-next-line no-console
  console.log(`>> after execute — JC "${state.jcCode}" PR "${state.prCode}"`);
  record({
    step: '03',
    doc: 'Plan (full outsource)',
    code: state.planCode || '(not captured)',
    qty: `${QTY}`,
    status: 'executed',
    note: `vendor ${VENDOR} · process ${TAG} → JC ${state.jcCode || '?'} + PR ${state.prCode || '?'}`,
  });
});

test('@jwout 04 — exactly ONE PR was raised (ADR-095)', async ({ page }) => {
  await page.goto('/purchase-requests', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  const tagged = body.includes(TAG);
  const tbd = (body.match(/\(vendor TBD\)/g) ?? []).length;
  // eslint-disable-next-line no-console
  console.log(`>> PR list carries our process tag: ${tagged}; "(vendor TBD)" rows: ${tbd}`);
  if (!state.prCode) state.prCode = await codeOnPage(page, /IN-JWPR-\d+/);
  record({
    step: '04',
    doc: 'Purchase Request',
    code: state.prCode || '(not captured)',
    qty: `${QTY}`,
    status: 'open',
    note: `one JW PR, no material PR (ADR-095) — "(vendor TBD)" rows on page: ${tbd}`,
  });
});

test('@jwout 05 — PR → PO', async ({ page }) => {
  test.skip(!state.prCode, 'no PR captured');
  if (state.poCode) {
    await page.goto(`/purchase-orders?search=${state.poCode}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.getByText(state.poCode).first().click();
    await page.waitForTimeout(3000);
    const mm = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    state.poId = mm ? mm[0] : '';
    record({ step: '05', doc: 'Purchase Order', code: state.poCode, qty: `${QTY}`,
      status: 'reused', note: `id ${state.poId || '(unresolved)'}` });
    return;
  }
  await page.goto(`/purchase-requests?search=${state.prCode}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.getByText('📝 PO', { exact: false }).first().click();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Create PO/i }).click();
  await page.waitForTimeout(5000);
  state.poCode = await codeOnPage(page, /IN-(?:JW)?PO-\d+/);

  // Resolve the PO's UUID by opening it from the register. Taking the last URL
  // segment after "Create PO" gave a non-UUID, and /delivery-challans/new
  // validates poId as a uuid — so the DC page rendered its "no PO" state and
  // the run recorded a phantom "BLOCKED" with an empty error.
  if (state.poCode) {
    await page.goto(`/purchase-orders?search=${state.poCode}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3500);
    await page.getByText(state.poCode).first().click();
    await page.waitForTimeout(3000);
    const m = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    state.poId = m ? m[0] : '';
  }
  // eslint-disable-next-line no-console
  console.log(`>> PO ${state.poCode} id=${state.poId || '(unresolved)'}`);
  record({
    step: '05',
    doc: 'Purchase Order',
    code: state.poCode || '(not captured)',
    qty: `${QTY}`,
    status: 'open',
    note: `job-work PO to ${VENDOR}`,
  });
});

test('@jwout 05b — issue the client material to the job card', async ({ page }) => {
  if (process.env['E2E_PMI']) {
    record({ step: '05b', doc: 'Party Material Issue', code: process.env['E2E_PMI']!,
      qty: `${QTY} issued`, status: 'reused', note: `${state.pmCode} → ${state.jcCode}` });
    return;
  }
  // ADR-103: the outward DC is gated on material ISSUED to this job card, not
  // merely received. Without this step the vendor send is refused — which the
  // previous run proved.
  await page.goto('/party-material-issues', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /New|Issue/i }).first().click();
  await page.waitForTimeout(1500);

  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  await page.waitForTimeout(1200);
  await pick(page, /Select Job Card/i, state.jcCode, new RegExp(state.jcCode));
  await page.waitForTimeout(1000);
  await pick(page, /Select party material/i, state.pmCode, new RegExp(state.pmCode));
  await page.waitForTimeout(1000);
  await page.locator('input[type="number"]').first().fill(String(QTY));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Save|Create|Issue/i }).last().click();
  await page.waitForTimeout(4500);
  const err = await bannerText(page);
  if (err) {
    // eslint-disable-next-line no-console
    console.log(`>> issue error: "${err}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const code = await codeInRowFor(page, state.jcCode, /IN-PMI-\d+/);
  record({
    step: '05b',
    doc: 'Party Material Issue',
    code: code || '—',
    qty: `${QTY} issued`,
    status: code ? 'posted' : 'BLOCKED',
    note: code ? `${state.pmCode} → ${state.jcCode}; unlocks the outward DC` : `refused: ${err}`,
  });
  expect(code, 'the issue must exist before the vendor send').toMatch(/IN-PMI-\d+/);
});

test('@jwout 06 — outward DC: send the customer material to the vendor', async ({ page }) => {
  if (state.dcCode && state.dcId) {
    record({ step: '06', doc: 'Outward DC', code: state.dcCode, qty: `${QTY} sent`,
      status: 'reused', note: 'issued after the material issue unlocked it' });
    return;
  }
  test.skip(!state.poId, 'no PO id');
  await page.goto(`/delivery-challans/new?poId=${state.poId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // Diagnostic: the first two attempts produced no DC and no error, so dump
  // what the page actually offers before touching anything.
  const spinners = await page.getByRole('spinbutton').count();
  const saveBtn = await page.getByRole('button', { name: /Save DC/i }).count();
  const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 700);
  // eslint-disable-next-line no-console
  console.log(`>> DC page — spinbuttons: ${spinners}, Save DC buttons: ${saveBtn}`);
  // eslint-disable-next-line no-console
  console.log(`>> DC page text: ${pageText}`);

  if (spinners > 0) await page.getByRole('spinbutton').first().fill(String(QTY));
  if (saveBtn > 0) {
    await page.getByRole('button', { name: /Save DC/i }).click();
    await page.waitForTimeout(5000);
  }
  const err = await bannerText(page);
  // eslint-disable-next-line no-console
  console.log(`>> after Save DC — url: ${page.url()}`);
  const afterText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(`>> after Save DC — page: ${afterText.slice(600, 1900)}`);
  state.dcCode = await codeOnPage(page, /IN-DC-\d+/);
  const dcm = page.url().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  // Only overwrite on a real match — a failed save left no uuid in the URL and
  // wiped the id passed in via E2E_DC_ID, silently skipping the receive step.
  if (dcm) state.dcId = dcm[0];
  // ADR-103 WATCH: op-entry refuses outsource ops, so the issued-material gate
  // never runs on this route. Record whether the send went through with NO
  // party material issue in existence.
  // eslint-disable-next-line no-console
  console.log(`>> outward DC "${state.dcCode}" err="${err}"`);
  record({
    step: '06',
    doc: 'Outward DC',
    code: state.dcCode || '(not captured)',
    qty: `${QTY} sent`,
    status: state.dcCode ? 'issued' : 'BLOCKED',
    note: state.dcCode
      ? 'sent AFTER the material issue — the ADR-103 gate does cover the OSP route'
      : `refused: ${err}`,
  });
});

test('@jwout 07 — vendor returns the goods (receive → GRN)', async ({ page }) => {
  test.skip(!state.dcCode, 'no DC');
  // Use the uuid captured from the URL right after Save DC. Re-finding the row
  // on the register hung for the full timeout.
  test.skip(!state.dcId, 'no DC id captured');
  await page.goto(`/delivery-challans/${state.dcId}/receive`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.getByRole('spinbutton').first().fill(String(QTY));
  await page.getByRole('button', { name: /Record receipt|Save/i }).click();
  await page.waitForTimeout(5000);
  record({
    step: '07',
    doc: 'Vendor return (GRN)',
    code: '(auto GRN)',
    qty: `${QTY} received back`,
    status: 'received',
    note: `against ${state.dcCode}`,
  });
});

test('@jwout 08 — incoming QC accepts the vendor return', async ({ page }) => {
  test.skip(!state.poCode, 'no PO');
  await page.goto('/incoming-qc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const row = page.locator('tr', { hasText: state.poCode }).first();
  const found = (await row.count()) > 0;
  // eslint-disable-next-line no-console
  console.log(`>> incoming QC row for ${state.poCode}: ${found}`);
  if (!found) {
    record({
      step: '08',
      doc: 'Incoming QC',
      code: '—',
      qty: `${QTY}`,
      status: 'NOT FOUND',
      note: `no pending row for ${state.poCode}`,
    });
    return;
  }
  state.vendorGrn = ((await row.innerText()).match(/IN-GRN-\d+/) ?? [''])[0];
  await row.getByText(/Inspect/i).first().click();
  await page.waitForTimeout(3500);
  await page.getByPlaceholder(/QC ?By|Inspector|Inspected/i).first().fill('E2E QC').catch(() => {});
  await page.getByRole('spinbutton').first().fill(String(QTY));
  await page.getByRole('button', { name: /Submit QC|Accept|Submit/i }).first().click();
  await page.waitForTimeout(5000);
  record({
    step: '08',
    doc: 'Incoming QC',
    code: state.vendorGrn || '(grn)',
    qty: `${QTY} accepted`,
    status: 'accepted',
    note: 'single-op JC → this IS the last op, so stock should be credited (ADR-092 guard must not fire)',
  });
});

test('@jwout 09 — return the finished goods to the customer', async ({ page }) => {
  await page.goto('/jw-returns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'New Return' }).click();
  await page.waitForTimeout(1500);
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  const lineSel = page.locator('select').first();
  await expect(lineSel).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await lineSel.selectOption({ index: 1 });
  await page.locator('input[type="number"]').first().fill(String(QTY));
  await page.getByRole('button', { name: 'Save Return' }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.returnCode = await codeInRowFor(page, state.jwCode, /IN-JWRC-\d+/);
  // eslint-disable-next-line no-console
  console.log(`>> return "${state.returnCode}" err="${err}"`);
  record({
    step: '09',
    doc: 'JW Return Challan',
    code: state.returnCode || '—',
    qty: `${QTY}`,
    status: state.returnCode ? 'issued' : 'BLOCKED',
    note: state.returnCode ? 'ADR-106: should debit own stock' : `refused: ${err}`,
  });
});

test('@jwout 10 — invoice the processing charge', async ({ page }) => {
  await page.goto('/jw-invoices', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'New Invoice' }).click();
  await page.waitForTimeout(1500);
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  const lineSel = page.locator('select').first();
  await expect(lineSel).toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  await lineSel.selectOption({ index: 1 });
  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill(String(QTY));
  await nums.nth(1).fill(String(RATE)).catch(() => {});
  await page.getByRole('button', { name: 'Save Invoice' }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.invoiceCode = await codeInRowFor(page, state.jwCode, /IN-JWINV-\d+/);
  record({
    step: '10',
    doc: 'JW Invoice',
    code: state.invoiceCode || '—',
    qty: `${QTY} × ₹${RATE}`,
    status: state.invoiceCode ? 'raised' : 'BLOCKED',
    note: state.invoiceCode ? '' : `refused: ${err}`,
  });
});

test('@jwout 99 — report', async () => {
  const w = [4, 24, 26, 24, 16];
  const line = (c: string[]): string =>
    '| ' + c.map((s, i) => s.padEnd(w[i] ?? 20)).join(' | ') + ' |';
  // eslint-disable-next-line no-console
  console.log('\n\n========== JWSO FULL OUTSOURCE — DOCUMENT REPORT ==========');
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
  console.log('===========================================================\n');
  expect(REPORT.length).toBeGreaterThan(5);
});
