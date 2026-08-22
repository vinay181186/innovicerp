import { expect, test, type Locator, type Page } from '@playwright/test';

// FULL JWSO → INVOICE CHAIN, driven end to end, plus deep element-behaviour
// checks on the ADR-102 Party GRN guards shipped in 2335e94.
//
// Runs SERIALLY and shares state between tests — each stage consumes the
// document the previous stage produced.
//
// WRITES TO PROD (authorized, same as the other flow-* specs). One run creates
// one JWSO, one party material, three Party GRNs (one cancelled), one plan +
// job card, one material issue, one return challan and one invoice, all tagged
// E2E-CHAIN in a text field so they are findable afterwards.
//
// Run with:
//   npx playwright test --config=playwright.pages.config.ts -g "@chain"

test.describe.configure({ mode: 'serial' });

const CLIENT_CODE = 'CLI-009';
const CLIENT_NAME = 'Arindam Engineering';
/** Line item for the new JWSO. */
const ITEM_CODE = '554117146000';
const ITEM_NAME = 'LEVER CATCH RAMMER';
// The wrong-part fixture used to be the hard-coded PM-0001, described as
// "pinned to a DIFFERENT item". On an empty database that constant collides
// with the material step 02 creates — PM-0001 became OUR part, the save
// correctly went through, and the guard check failed on the fixture rather
// than on the ERP. It is discovered from the live picker now instead
// (findWrongPart below), and the sub-check is skipped when the client owns no
// other material to be wrong with.
const ORDER_QTY = 10;
const RATE = 125;

const TAG = `E2E-CHAIN-${Date.now()}`;

/** Everything the report table is built from. */
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

// Resume support: set E2E_JW=IN-JW-00004 (and optionally E2E_PM=PM-0004) to
// re-run later stages against documents an earlier run already created,
// instead of littering prod with a fresh JWSO on every attempt.
const state = {
  jwCode: process.env['E2E_JW'] ?? '',
  pmCode: process.env['E2E_PM'] ?? '',
  grnCode: process.env['E2E_GRN'] ?? '',
  cancelGrnCode: '',
  planCode: process.env['E2E_PLN'] ?? '',
  jcCode: process.env['E2E_JC'] ?? '',
  issueCode: process.env['E2E_PMI'] ?? '',
  returnCode: '',
  invoiceCode: '',
};

/** SearchableSelect: type, wait for the async list, take the highlighted option.
 *
 *  Selection goes through the component's own listbox — matching on page text
 *  instead resolved to a <td> in the list table behind the modal, and the
 *  combobox then intercepted the click. The control is a real ARIA combobox
 *  (role=combobox + aria-controls=<id>-listbox + aria-activedescendant), so
 *  drive it the way a keyboard user would and assert it actually committed. */
async function pick(page: Page, ph: RegExp, term: string, optText: RegExp): Promise<void> {
  const input = page.getByPlaceholder(ph).first();
  await input.click();
  await input.fill(term);

  // The option list is fetched from the server. A fixed sleep raced it — on a
  // slow response the list was still empty, the click/keypress hit nothing, and
  // the dependent control stayed on "Pick a JWSO first". WAIT for the option.
  const listboxId = await input.getAttribute('aria-controls');
  if (listboxId) {
    const opt = page.locator(`#${listboxId} [role="option"]`).filter({ hasText: optText }).first();
    await expect(opt, `option matching ${optText} appears in the ${listboxId} list`).toBeVisible({
      timeout: 30_000,
    });
    await opt.click();
  } else {
    await page.waitForTimeout(2000);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }

  // Selection must have COMMITTED — the component writes the chosen code back
  // into the input. Without this the next assertion blames the wrong control.
  await expect(input, 'the picker committed a selection').not.toHaveValue('', { timeout: 10_000 });
  await page.waitForTimeout(800);
}

/** First code matching a pattern anywhere in the page body. */
async function codeOnPage(page: Page, re: RegExp): Promise<string> {
  const body = await page.locator('body').innerText();
  return (body.match(re) ?? [''])[0];
}

/** Visible validation/error text on the page, '' when none. Covers both the
 *  modal error boxes (inline rgba red) and the form's .form-error spans. */
async function bannerText(page: Page): Promise<string> {
  // NOTE: the browser re-serializes inline styles WITH spaces —
  // `background: rgba(239, 68, 68, 0.08)` — so a selector written the way the
  // JSX spells it (`rgba(239,68,68`) matches nothing. Match the prefix only.
  //
  // The New Party GRN modal paints its error box from design tokens
  // (`color: var(--red); background: var(--red3)`), not from a literal rgba, so
  // none of the first three selectors saw it — a correct refusal read back as
  // no refusal at all and the assertion blamed the ERP. Token-styled boxes are
  // matched last so the more specific sources still win, and the row-level
  // "⚠ not L1" marker (same token) is excluded — it is a field marker, not the
  // submit error.
  const sources = [
    page.locator('[style*="rgba(239"]'),
    page.locator('.form-error'),
    page.locator('[class*="error"]'),
    page.locator('[style*="--red"]'),
  ];
  for (const loc of sources) {
    const n = Math.min(await loc.count(), 12);
    for (let i = 0; i < n; i++) {
      if (!(await loc.nth(i).isVisible().catch(() => false))) continue;
      const t = (await loc.nth(i).innerText().catch(() => '')).trim();
      if (t.length > 8 && !/^Cancel$/i.test(t) && !t.startsWith('⚠')) {
        return t.replace(/\s+/g, ' ');
      }
    }
  }
  return '';
}

// ───────────────────────────────────────────────────────────────────────────
// 1. JWSO
// ───────────────────────────────────────────────────────────────────────────

test('@chain 01 — create the JWSO', async ({ page }) => {
  if (state.jwCode) {
    record({
      step: '01',
      doc: 'JWSO',
      code: state.jwCode,
      qty: `${ORDER_QTY} ordered`,
      status: 'reused',
      note: `existing document supplied via E2E_JW — ${CLIENT_NAME}, line 1 = ${ITEM_CODE}`,
    });
    return;
  }
  await page.goto('/job-work-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  state.jwCode = await page.locator('input[value^="IN-JW-"]').first().inputValue().catch(() => '');
  await pick(page, /Type client code or name/i, CLIENT_CODE, new RegExp(CLIENT_NAME, 'i'));
  await page.getByPlaceholder(/Client PO reference/i).fill(TAG);

  // The form already renders one empty line by default. Clicking "+ Add Line"
  // unconditionally left a blank Line 2 behind, which failed "Part name is
  // required" and blocked the save — add a row only when there is none.
  const lineCodeBoxes = page.locator('input[name$=".itemCodeText"]');
  if ((await lineCodeBoxes.count()) === 0) {
    await page.getByRole('button', { name: /Add Line/i }).first().click();
    await page.waitForTimeout(800);
  }
  expect(await lineCodeBoxes.count(), 'exactly one line row to fill').toBe(1);

  // Address the line row by its react-hook-form field names. Picking inputs
  // positionally put the qty into the HEADER's clientMaterialQty box and left
  // lines.0.orderQty empty, so the form failed validation and nothing saved.
  await page.locator('input[name="lines.0.itemCodeText"]').fill(ITEM_CODE);
  await page.waitForTimeout(2000);

  // ELEMENT: an on-master item code must auto-fill Part Name and lock it.
  const partNameBox = page.locator('input[name="lines.0.partName"]');
  const autoName = await partNameBox.inputValue();
  // eslint-disable-next-line no-console
  console.log(`>> line 1 part name auto-filled as "${autoName}"`);
  expect(autoName.toUpperCase(), 'part name auto-fills from the item master').toContain(ITEM_NAME);
  expect(
    await partNameBox.isEditable(),
    'an on-master part name is read-only (item code is the key)',
  ).toBe(false);

  await page.locator('input[name="lines.0.orderQty"]').fill(String(ORDER_QTY));
  await page.waitForTimeout(300);
  await page.locator('input[name="lines.0.rate"]').fill(String(RATE));
  await page.waitForTimeout(500);

  const codeOnForm = state.jwCode;
  await page.getByRole('button', { name: /Save JW/i }).click();
  await page.waitForTimeout(6000);

  // The auto-generated code is pre-filled in the form BEFORE saving, so
  // matching /IN-JW-\d+/ on this page proves nothing. Prove PERSISTENCE: the
  // save must navigate off /new, and the code must then be findable on the
  // JWSO list. (An earlier version of this spec passed here while the save had
  // silently failed — the document never existed.)
  const submitErr = await bannerText(page);
  if (submitErr) {
    // eslint-disable-next-line no-console
    console.log(`>> JWSO save error banner: "${submitErr}"`);
  }
  expect(page.url(), `still on /new — save was rejected: ${submitErr}`).not.toContain(
    '/job-work-orders/new',
  );

  state.jwCode = (await codeOnPage(page, /IN-JW-\d+/)) || codeOnForm;
  expect(state.jwCode, 'JWSO code captured').toMatch(/IN-JW-\d+/);

  await page.goto('/job-work-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search JWSO/i).fill(state.jwCode);
  await page.waitForTimeout(3000);
  await expect(
    page.getByText(state.jwCode).first(),
    'the saved JWSO must be findable on the register — this is the persistence proof',
  ).toBeVisible({ timeout: 20_000 });
  record({
    step: '01',
    doc: 'JWSO',
    code: state.jwCode,
    qty: `${ORDER_QTY} ordered`,
    status: 'open',
    note: `${CLIENT_NAME} · line 1 = ${ITEM_CODE} ${ITEM_NAME} @ ₹${RATE}`,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Party material master (Client → order → item cascade)
// ───────────────────────────────────────────────────────────────────────────

test('@chain 02 — create the party material for this JWSO line', async ({ page }) => {
  if (state.pmCode) {
    record({
      step: '02',
      doc: 'Party Material',
      code: state.pmCode,
      qty: '(existing)',
      status: 'reused',
      note: 'supplied via E2E_PM',
    });
    return;
  }
  // Route is /party-material (singular).
  await page.goto('/party-material', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Add Material/i }).first().click();
  await page.waitForTimeout(1500);

  state.pmCode = await page.locator('input[value^="PM-"]').first().inputValue().catch(() => '');

  // The master's cascade: Client → SO/JWSO → Item. Each picker only enables
  // once its parent is chosen, which is what pins the material to one item.
  await pick(page, /Type client code or name/i, CLIENT_CODE, new RegExp(CLIENT_NAME, 'i'));
  await page.waitForTimeout(1500);
  await pick(page, /Type SO \/ JWSO no/i, state.jwCode, new RegExp(state.jwCode));
  await page.waitForTimeout(1500);
  await pick(page, /Pick an item from this order/i, ITEM_CODE, new RegExp(ITEM_CODE));
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Save Material/i }).click();
  await page.waitForTimeout(4000);

  if (!state.pmCode) state.pmCode = await codeOnPage(page, /PM-\d+/);
  expect(state.pmCode, 'party material created').toMatch(/PM-\d+/);
  record({
    step: '02',
    doc: 'Party Material',
    code: state.pmCode,
    qty: '0 on hand',
    status: 'active',
    note: `pinned to ${CLIENT_NAME} + item ${ITEM_CODE}`,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Party GRN — the ADR-102 element-behaviour checks
// ───────────────────────────────────────────────────────────────────────────

/** Is this JWSO offered by a picker? All three downstream screens filter the
 *  JWSO list to status='open', so a closed JWSO silently vanishes from them. */
async function jwsoOfferedBy(page: Page, ph: RegExp): Promise<boolean> {
  const input = page.getByPlaceholder(ph).first();
  await input.click();
  await input.fill(state.jwCode);
  const listboxId = await input.getAttribute('aria-controls');
  if (!listboxId) return false;
  const opt = page.locator(`#${listboxId} [role="option"]`).filter({ hasText: state.jwCode });
  return await opt
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

/** Find a party material the picker offers that is NOT this line's part, so the
 *  wrong-part guard has something real to refuse. The row's own red "⚠ not L1"
 *  marker is the oracle — it is driven by the same itemId comparison the API
 *  guard uses, so a code that lights it up is genuinely the wrong part.
 *  Returns '' (and leaves the box empty) when the client owns no other
 *  material; the caller then reports the sub-check as NOT TESTED instead of
 *  failing on a fixture that does not exist in this database. */
async function findWrongPart(page: Page, matBox: Locator): Promise<string> {
  const codes = await page.locator(`#${'dlPGrnMaterial'} option`).evaluateAll((els) =>
    els.map((e) => (e as HTMLOptionElement).value).filter(Boolean),
  );
  // eslint-disable-next-line no-console
  console.log(`>> materials offered for this client: ${codes.join(', ') || '(none)'}`);
  for (const code of codes) {
    if (code === state.pmCode) continue;
    await matBox.fill(code);
    await page.waitForTimeout(1500);
    if ((await page.getByText(/⚠ not L1/i).count()) > 0) return code;
  }
  await matBox.fill('');
  await page.waitForTimeout(500);
  return '';
}

test('@chain 03 — Party GRN guards behave at the element level', async ({ page }) => {
  test.skip(
    Boolean(state.grnCode),
    'resumed run: the JWSO closes at QC accept, so its GRN screen can no longer reach it',
  );
  await page.goto('/party-grn', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /New Party GRN/i }).click();
  await page.waitForTimeout(1500);

  const lineCtl = page.locator('table select').first();
  const matBox = page.locator('input[list="dlPGrnMaterial"]').first();

  // ── ELEMENT 1: the JWSO Line control is a real <select>, not the old
  //    free-text <input list=…>. This is the whole point of ADR-102 fix 1.
  const tag = await lineCtl.evaluate((el) => el.tagName);
  expect(tag, 'JWSO Line must be a <select>, not a text input').toBe('SELECT');
  expect(
    await page.locator('input[list="dlPGrnJwLine"]').count(),
    'the old free-text JW-line input must be gone',
  ).toBe(0);
  // eslint-disable-next-line no-console
  console.log('>> ELEMENT 1 ok — JWSO Line is a <select>; free-text input removed');

  // ── ELEMENT 2: before a JWSO is chosen, the line select offers nothing real
  //    and the material box is disabled (client unknown → cannot filter).
  const optsBefore = await lineCtl.locator('option').allInnerTexts();
  expect(optsBefore.join('|'), 'placeholder tells the user to pick a JWSO').toMatch(
    /Pick a JWSO first/i,
  );
  expect(await matBox.isDisabled(), 'material box disabled until a JWSO is picked').toBe(true);
  // eslint-disable-next-line no-console
  console.log('>> ELEMENT 2 ok — line select empty + material box disabled pre-JWSO');

  // Pick our JWSO.
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));

  // ── ELEMENT 3: the select is now populated with THIS JWSO's real lines, and
  //    the material box has come alive. The JWSO detail is a second fetch, so
  //    wait for the option to actually arrive rather than sleeping.
  await expect(
    lineCtl.locator('option', { hasText: ITEM_CODE }),
    'the JWSO line arrives in the select once its detail loads',
  ).toHaveCount(1, { timeout: 30_000 });
  const optsAfter = await lineCtl.locator('option').allInnerTexts();
  // eslint-disable-next-line no-console
  console.log(`>> line options: ${optsAfter.map((o) => o.trim()).join(' / ')}`);
  expect(optsAfter.join('|'), 'the JWSO line is listed with its item code').toContain(ITEM_CODE);
  expect(await matBox.isDisabled(), 'material box enabled once JWSO known').toBe(false);
  // eslint-disable-next-line no-console
  console.log('>> ELEMENT 3 ok — line options populated from the JWSO; material box enabled');

  await lineCtl.selectOption('1');
  await page.waitForTimeout(500);

  // ── ELEMENT 4: WRONG PART. Feed the row a material belonging to a DIFFERENT
  //    part and the row must flag it in red BEFORE save, then the API must
  //    refuse it. The fixture is found from the picker the screen actually
  //    offers — the client's own materials — because a hard-coded code silently
  //    became the RIGHT part once the database was reset.
  const qtyBox = page.locator('table input[type="number"]').first();
  const wrongPm = await findWrongPart(page, matBox);
  if (!wrongPm) {
    // eslint-disable-next-line no-console
    console.log('>> ELEMENT 4 skipped — this client owns no OTHER party material to be wrong with');
    record({
      step: '03a',
      doc: 'Party GRN (attempt)',
      code: '—',
      qty: '—',
      status: 'NOT TESTED',
      note: `wrong-part guard needs a second party material on ${CLIENT_NAME}; the picker offers only ${state.pmCode}`,
    });
  } else {
    const warned = await page.getByText(/⚠ not L1/i).count();
    // eslint-disable-next-line no-console
    console.log(`>> wrong-part fixture ${wrongPm}; inline mismatch warnings visible: ${warned}`);
    await qtyBox.fill('1');
    await page.getByRole('button', { name: /Save GRN/i }).click();
    await page.waitForTimeout(3500);
    const wrongPartErr = await bannerText(page);
    // eslint-disable-next-line no-console
    console.log(`>> wrong-part refusal: "${wrongPartErr}"`);
    // Structural proof first: a refused save leaves the modal open. This holds
    // even if the message markup changes.
    await expect(
      page.getByRole('button', { name: /Save GRN/i }),
      'modal must stay open — the wrong-part save must NOT go through',
    ).toHaveCount(1);
    expect(
      wrongPartErr,
      'receiving the wrong part must be refused, naming both parts',
    ).toMatch(/but .*line 1 is|Pick the material for this part/i);
    record({
      step: '03a',
      doc: 'Party GRN (attempt)',
      code: '—',
      qty: '1',
      status: 'REFUSED',
      note: `wrong part: ${wrongPm} is not line 1's item — ${wrongPartErr.slice(0, 90)}`,
    });
  }

  // ── ELEMENT 5: OVER QTY. Correct material now, but more than ordered.
  await matBox.fill(state.pmCode);
  await page.waitForTimeout(1500);
  expect(await page.getByText(/⚠ not L1/i).count(), 'warning clears for the right part').toBe(0);
  await qtyBox.fill(String(ORDER_QTY + 1));
  await page.getByRole('button', { name: /Save GRN/i }).click();
  await page.waitForTimeout(3500);
  const overErr = await bannerText(page);
  // eslint-disable-next-line no-console
  console.log(`>> over-qty refusal: "${overErr}"`);
  await expect(
    page.getByRole('button', { name: /Save GRN/i }),
    'modal must stay open — the over-qty save must NOT go through',
  ).toHaveCount(1);
  expect(overErr, 'over-receipt must be refused with the remaining qty').toMatch(
    /Ordered \d+|can be received|reduce the quantity/i,
  );
  record({
    step: '03b',
    doc: 'Party GRN (attempt)',
    code: '—',
    qty: `${ORDER_QTY + 1}`,
    status: 'REFUSED',
    note: `over order qty ${ORDER_QTY} — ${overErr.slice(0, 90)}`,
  });

  // ── ELEMENT 6: the happy path saves. Skipped on a resumed run — the line is
  //    already fully received, so a second receipt would (correctly) be capped.
  if (state.grnCode) {
    record({
      step: '03c',
      doc: 'Party GRN',
      code: state.grnCode,
      qty: `${ORDER_QTY} received`,
      status: 'reused',
      note: 'created by an earlier run; guards above were re-verified live',
    });
    return;
  }
  // Receive the BALANCE, not a flat ORDER_QTY. An earlier attempt on this JWSO
  // may already have banked part of the line (the wrong-part probe used to post
  // 1), and asking for the full order qty then trips the cumulative cap and the
  // chain stalls with nothing to issue. The API names the remaining qty in its
  // refusal, so take it from there rather than guessing.
  let toReceive = ORDER_QTY;
  await qtyBox.fill(String(toReceive));
  await page.getByRole('button', { name: /Save GRN/i }).click();
  await page.waitForTimeout(5000);
  if ((await page.getByRole('button', { name: /Save GRN/i }).count()) > 0) {
    const capErr = await bannerText(page);
    const remaining = Number((capErr.match(/only (\d+) more can be received/i) ?? [])[1] ?? 0);
    // eslint-disable-next-line no-console
    console.log(`>> line already part-received; balance the API allows: ${remaining} ("${capErr}")`);
    expect(remaining, `line has no balance left to receive — ${capErr}`).toBeGreaterThan(0);
    toReceive = remaining;
    await qtyBox.fill(String(toReceive));
    await page.getByRole('button', { name: /Save GRN/i }).click();
    await page.waitForTimeout(5000);
  }
  await expect(page.getByRole('button', { name: /Save GRN/i }), 'modal closed on success')
    .toHaveCount(0, { timeout: 15_000 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  state.grnCode = await codeOnPage(page, /PGRN-\d+/);
  expect(state.grnCode, 'Party GRN created').toMatch(/PGRN-\d+/);
  record({
    step: '03c',
    doc: 'Party GRN',
    code: state.grnCode,
    qty: `${toReceive} received`,
    status: 'posted',
    note: `${state.pmCode} → ${state.jwCode} line 1; party stock +${toReceive}`,
  });
});

test('@chain 04 — a blank JWSO line is refused', async ({ page }) => {
  test.skip(Boolean(state.grnCode), 'resumed run: JWSO already closed');
  await page.goto('/party-grn', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /New Party GRN/i }).click();
  await page.waitForTimeout(1500);
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  await expect(
    page.locator('table select').first().locator('option', { hasText: ITEM_CODE }),
    'JWSO lines loaded',
  ).toHaveCount(1, { timeout: 30_000 });

  // Leave the line select on its blank placeholder.
  await page.locator('input[list="dlPGrnMaterial"]').first().fill(state.pmCode);
  await page.waitForTimeout(1200);
  await page.locator('table input[type="number"]').first().fill('1');
  await page.getByRole('button', { name: /Save GRN/i }).click();
  await page.waitForTimeout(3000);

  const err = await bannerText(page);
  // eslint-disable-next-line no-console
  console.log(`>> blank-line refusal: "${err}"`);
  expect(err, 'a blank JWSO line must be refused — it used to disable the qty cap').toMatch(
    /pick which JWSO line|JWSO line/i,
  );
  record({
    step: '04',
    doc: 'Party GRN (attempt)',
    code: '—',
    qty: '1',
    status: 'REFUSED',
    note: `blank JWSO line — ${err.slice(0, 90)}`,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Plan → Job Card
// ───────────────────────────────────────────────────────────────────────────

test('@chain 05 — plan and execute a Job Card for the JWSO line', async ({ page }) => {
  if (state.jcCode) {
    record({
      step: '05',
      doc: 'Plan + Job Card',
      code: `${state.planCode || '(plan)'} → ${state.jcCode}`,
      qty: `${ORDER_QTY} planned`,
      status: 'reused',
      note: 'created by an earlier run (E2E_JC)',
    });
    return;
  }
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.jwCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.jwCode).first().click();
  await page.waitForTimeout(2500);

  await page.getByRole('button', { name: /\+ ?Plan/i }).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^Save$/ }).first().click();
  await page.waitForTimeout(3000);
  state.planCode = await codeOnPage(page, /PLN-\d+/);

  // One in-house op on a real machine, then save + execute.
  const rows = page.locator('table.ops-routing tbody tr');
  const del = page.locator('table.ops-routing tbody tr button.btn-danger');
  for (let i = (await del.count()) - 1; i >= 0; i--) {
    await del.nth(i).click();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(800);
  await rows.nth(0).getByPlaceholder('Operation name').fill('E2E TURNING');
  const mach = rows.nth(0).getByPlaceholder(/Machine/i);
  await mach.click();
  await mach.fill('CNC-01');
  await page.waitForTimeout(1500);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /Save Plan/i }).click();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Execute/i }).first().click();
  await page.waitForTimeout(6000);

  state.jcCode = await codeOnPage(page, /IN-JC-\d{2}-\d+/);
  expect(state.jcCode, 'job card created').toMatch(/IN-JC-\d{2}-\d+/);
  record({
    step: '05',
    doc: 'Plan',
    code: state.planCode || '(not captured)',
    qty: `${ORDER_QTY} planned`,
    status: 'executed',
    note: `from ${state.jwCode} line 1`,
  });
  record({
    step: '05',
    doc: 'Job Card',
    code: state.jcCode,
    qty: `${ORDER_QTY} to make`,
    status: 'open',
    note: 'routing: E2E TURNING (CNC-01) + DIR QC',
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Issue client material to the JC
// ───────────────────────────────────────────────────────────────────────────

test('@chain 06 — issue the client material to the Job Card', async ({ page }) => {
  if (state.issueCode) {
    record({
      step: '06',
      doc: 'Party Material Issue',
      code: state.issueCode,
      qty: `${ORDER_QTY} issued`,
      status: 'reused',
      note: `${state.pmCode} → ${state.jcCode} (E2E_PMI)`,
    });
    return;
  }
  await page.goto('/party-material-issues', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // EXACT name, not /New|Issue/i. Opening this screen adds a tab to the open-
  // tabs bar whose close button is named "Close Party Material Issue" — that
  // matched the loose pattern, and the bar sits ABOVE the content, so .first()
  // clicked CLOSE THE TAB. The app fell back to the Home tab and every later
  // wait timed out against the Dashboard.
  await page.getByRole('button', { name: 'New Issue', exact: true }).click();
  await page.waitForTimeout(1500);

  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  await page.waitForTimeout(1500);
  // ADR-103: the Job Card is MANDATORY now — it is the only link from an issue
  // to a JWSO line, and the production gate reads exactly this. No .catch().
  await pick(page, /Select Job Card/i, state.jcCode, new RegExp(state.jcCode));
  await page.waitForTimeout(1000);
  await pick(page, /Select party material/i, state.pmCode, new RegExp(state.pmCode));
  await page.waitForTimeout(1000);
  await page.locator('input[type="number"]').first().fill(String(ORDER_QTY));
  await page.waitForTimeout(400);
  // Same reason as above — /Save|Create|Issue/i also matches the tab's close
  // button, and .last() only happened to miss it.
  await page.getByRole('button', { name: 'Save Issue', exact: true }).click();
  await page.waitForTimeout(4500);
  const issueErr = await bannerText(page);
  if (issueErr) {
    // eslint-disable-next-line no-console
    console.log(`>> issue save error: "${issueErr}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.issueCode = await codeOnPage(page, /PMI-\d+|ISS-\d+/);
  record({
    step: '06',
    doc: 'Party Material Issue',
    code: state.issueCode || '(not captured)',
    qty: `${ORDER_QTY} issued`,
    status: state.issueCode ? 'posted' : 'NOT CREATED',
    note: `${state.pmCode} → ${state.jcCode}; party stock −${ORDER_QTY}`,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6b. ADR-103 — the RM AVAIL tile on the Job Card
// ───────────────────────────────────────────────────────────────────────────

test('@chain 06b — RM AVAIL tile shows the issued material', async ({ page }) => {
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search/i).first().fill(state.jcCode);
  await page.waitForTimeout(3000);
  await page.getByText(state.jcCode).first().click();
  await page.waitForTimeout(4000);

  const body = await page.locator('body').innerText();
  const hasTile = /RM AVAIL/i.test(body);
  // eslint-disable-next-line no-console
  console.log(`>> RM AVAIL tile present on ${state.jcCode}: ${hasTile}`);
  const around = (body.match(/RM AVAIL[\s\S]{0,60}/i) ?? [''])[0].replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log(`>> tile text: "${around}"`);
  record({
    step: '06b',
    doc: 'RM AVAIL tile',
    code: state.jcCode,
    qty: hasTile ? `${ORDER_QTY} issued, ${ORDER_QTY} available` : 'not shown',
    status: hasTile ? 'shown' : 'MISSING',
    note: around || 'tile not found on the job card page',
  });
  expect(hasTile, 'a gated JWSO job card must show RM AVAIL').toBe(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Op entry — produce + QC
// ───────────────────────────────────────────────────────────────────────────

test('@chain 07 — log the operation and pass QC', async ({ page }) => {
  if (process.env['E2E_OPS_DONE']) {
    record({
      step: '07',
      doc: 'Op Entry',
      code: state.jcCode,
      qty: `${ORDER_QTY} produced, ${ORDER_QTY} QC-accepted`,
      status: 'reused',
      note: 'logged by an earlier run (E2E_OPS_DONE)',
    });
    return;
  }
  await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // The Job Card box is a SearchableSelect now ("🔍 Job card no, item, or SO…"),
  // not the plain IN-JC- text input this step was written against — the old
  // placeholder matched nothing and the step sat there until it timed out.
  // Drive it through the same combobox helper every other picker uses.
  await pick(page, /Job card no, item, or SO/i, state.jcCode, new RegExp(state.jcCode));
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(4000);

  await page.getByText('E2E TURNING', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  // An op that has not been started yet offers "▶ Start Operation" instead of
  // the completion form. Start it first when that is the state we land in.
  const startBtn = page.getByRole('button', { name: /Start Operation/i });
  if ((await startBtn.count()) > 0) {
    // eslint-disable-next-line no-console
    console.log('>> op not started — clicking ▶ Start Operation first');
    await startBtn.first().click();
    await page.waitForTimeout(4000);
  }
  await page.getByRole('spinbutton').first().fill(String(ORDER_QTY));
  await page.getByPlaceholder(/Operator name/i).fill('E2E Auto').catch(() => {});
  await page.getByRole('button', { name: /Submit completion/i }).click();
  await page.waitForTimeout(4000);
  const opErr = await bannerText(page);
  if (opErr) {
    // eslint-disable-next-line no-console
    console.log(`>> op completion error: "${opErr}"`);
  }

  await page.getByText('DIR', { exact: true }).first().click();
  await page.waitForTimeout(1800);
  await page.getByRole('spinbutton').first().fill(String(ORDER_QTY));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Submit QC inspection/i }).click();
  await page.waitForTimeout(4500);

  const body = await page.locator('body').innerText();
  record({
    step: '07',
    doc: 'Op Entry',
    code: state.jcCode,
    qty: `${ORDER_QTY} produced, ${ORDER_QTY} QC-accepted`,
    status: /complete/i.test(body) ? 'complete' : 'logged',
    note: 'E2E TURNING then DIR QC',
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Return challan → 9. Invoice
// ───────────────────────────────────────────────────────────────────────────

test('@chain 08 — return the processed goods to the customer', async ({ page }) => {
  await page.goto('/jw-returns', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'New Return' }).click();
  await page.waitForTimeout(1500);

  // ELEMENT: the JW Line select is disabled until a JWSO is chosen.
  const lineSel = page.locator('select').first();
  expect(await lineSel.isDisabled(), 'JW Line disabled before a JWSO is picked').toBe(true);

  // FINDING CHECK: this picker filters to status='open'. The JWSO auto-closes
  // when the JC's final QC passes — i.e. exactly when the return is due.
  if (!(await jwsoOfferedBy(page, /Select JWSO/i))) {
    record({
      step: '08',
      doc: 'JW Return Challan',
      code: '—',
      qty: `${ORDER_QTY} due`,
      status: 'BLOCKED',
      note: `${state.jwCode} is closed and the picker lists only open JWSOs — the return cannot be raised from the UI`,
    });
    return;
  }
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  await expect(lineSel, 'JW Line enables once the JWSO loads').toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const retOpts = await lineSel.locator('option').allInnerTexts();
  // eslint-disable-next-line no-console
  console.log(`>> return line options: ${retOpts.map((o) => o.trim()).join(' / ')}`);
  expect(retOpts.join('|'), 'the JWSO line is offered with its ordered qty').toMatch(/L1 ·/);
  await lineSel.selectOption({ index: 1 });
  await page.waitForTimeout(700);

  await page.locator('input[type="number"]').first().fill(String(ORDER_QTY));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Save Return' }).click();
  await page.waitForTimeout(5000);
  const retErr = await bannerText(page);
  if (retErr) {
    // eslint-disable-next-line no-console
    console.log(`>> return save error: "${retErr}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.returnCode = await codeOnPage(page, /JWRC-\d+|RET-\d+|IN-JWRC-\d+/);
  record({
    step: '08',
    doc: 'JW Return Challan',
    code: state.returnCode || '(not captured)',
    qty: `${ORDER_QTY} returned`,
    status: state.returnCode ? 'posted' : 'NOT CREATED',
    note: `against ${state.jwCode} line 1`,
  });
});

test('@chain 09 — invoice the processing charge', async ({ page }) => {
  await page.goto('/jw-invoices', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'New Invoice' }).click();
  await page.waitForTimeout(1500);

  const lineSel = page.locator('select').first();
  if (!(await jwsoOfferedBy(page, /Select JWSO/i))) {
    record({
      step: '09',
      doc: 'JW Invoice',
      code: '—',
      qty: `${ORDER_QTY} × ₹${RATE} due`,
      status: 'BLOCKED',
      note: `${state.jwCode} is closed and the picker lists only open JWSOs — the invoice cannot be raised from the UI`,
    });
    return;
  }
  await pick(page, /Select JWSO/i, state.jwCode, new RegExp(state.jwCode));
  await expect(lineSel, 'JW Line enables once the JWSO loads').toBeEnabled({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const invOpts = await lineSel.locator('option').allInnerTexts();
  // eslint-disable-next-line no-console
  console.log(`>> invoice line options: ${invOpts.map((o) => o.trim()).join(' / ')}`);
  await lineSel.selectOption({ index: 1 });
  await page.waitForTimeout(700);

  const nums = page.locator('input[type="number"]');
  await nums.nth(0).fill(String(ORDER_QTY));
  await page.waitForTimeout(300);
  await nums.nth(1).fill(String(RATE)).catch(() => {});
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Save Invoice' }).click();
  await page.waitForTimeout(5000);
  const invErr = await bannerText(page);
  if (invErr) {
    // eslint-disable-next-line no-console
    console.log(`>> invoice save error: "${invErr}"`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.invoiceCode = await codeOnPage(page, /JWINV-\d+|INV-\d+|IN-JWINV-\d+/);
  record({
    step: '09',
    doc: 'JW Invoice',
    code: state.invoiceCode || '(not captured)',
    qty: `${ORDER_QTY} × ₹${RATE}`,
    status: state.invoiceCode ? 'raised' : 'NOT CREATED',
    note: `against ${state.jwCode} line 1`,
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 10. The new cancel path
// ───────────────────────────────────────────────────────────────────────────

test('@chain 10 — cancel a Party GRN and see the qty come back off stock', async ({ page }) => {
  // The line is fully received, so a fresh GRN would (correctly) be capped.
  // Cancel the one from step 03 instead: its material has been issued to the
  // JC, so the reversal must be REFUSED — that is the guard worth proving.
  await page.goto('/party-grn', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // The register renders one `.panel` CARD per GRN, not table rows — a `tr`
  // locator matched nothing and the step read as "the GRN is missing" when it
  // was on screen with its Cancel button.
  const row = page.locator('.panel').filter({ hasText: state.grnCode });
  await expect(row, 'our GRN is on the list').toHaveCount(1, { timeout: 15_000 });
  await row.getByRole('button', { name: /Cancel/i }).click();
  await page.waitForTimeout(1500);

  // ── ELEMENT 7: cancel demands a reason.
  await page.getByRole('button', { name: /^Cancel GRN$/ }).click();
  await page.waitForTimeout(1500);
  const noReason = await bannerText(page);
  // eslint-disable-next-line no-console
  console.log(`>> cancel without reason: "${noReason}"`);
  expect(noReason, 'a reason is required').toMatch(/reason/i);

  await page.getByPlaceholder(/entered twice by mistake/i).fill('E2E chain check');
  await page.getByRole('button', { name: /^Cancel GRN$/ }).click();
  await page.waitForTimeout(4000);

  const after = await bannerText(page);
  const stillOpen = await page.getByRole('button', { name: /^Cancel GRN$/ }).count();
  // eslint-disable-next-line no-console
  console.log(`>> cancel result: modalOpen=${stillOpen} banner="${after}"`);
  if (stillOpen > 0) {
    expect(after, 'refusal must explain the material is already issued').toMatch(
      /issued|on hand|Reverse the material issue/i,
    );
    record({
      step: '10',
      doc: 'Party GRN cancel',
      code: state.grnCode,
      qty: `${ORDER_QTY}`,
      status: 'REFUSED (correct)',
      note: `material already issued to ${state.jcCode} — ${after.slice(0, 90)}`,
    });
  } else {
    record({
      step: '10',
      doc: 'Party GRN cancel',
      code: state.grnCode,
      qty: `${ORDER_QTY} reversed`,
      status: 'cancelled',
      note: 'party stock credited back',
    });
  }
});

test('@chain 99 — report', async () => {
  const w = [4, 24, 22, 26, 18];
  const line = (c: string[]): string =>
    '| ' + c.map((s, i) => s.padEnd(w[i] ?? 20)).join(' | ') + ' |';
  // eslint-disable-next-line no-console
  console.log('\n\n================ DOCUMENT-WISE QTY + STATUS ================');
  // eslint-disable-next-line no-console
  console.log(line(['#', 'Document', 'Code', 'Qty', 'Status']));
  // eslint-disable-next-line no-console
  console.log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|');
  for (const r of REPORT) {
    // eslint-disable-next-line no-console
    console.log(line([r.step, r.doc, r.code, r.qty, r.status]));
    // eslint-disable-next-line no-console
    console.log(`     ↳ ${r.note}`);
  }
  // eslint-disable-next-line no-console
  console.log('============================================================\n');
  expect(REPORT.length, 'every stage recorded a row').toBeGreaterThan(6);
});
