import { expect, test, type Page } from '@playwright/test';

// A multi-item, mixed-type BOM driven the whole way: BOM -> equipment SO ->
// explosion -> plans -> job cards -> JOB CARD EDITS -> production -> QC ->
// procurement for the bought/outsourced children -> dispatch -> invoice.
//
//   child 1  COVER              manufacture   -> job card
//   child 2  ARM                manufacture   -> job card  (two, so the edit
//                                                tests have a JC to mangle
//                                                without stalling the other)
//   child 3  THREADED HOUSING   purchase      -> PR -> PO -> GRN
//   child 4  LEVER CATCH RAMMER outsource     -> PR -> PO -> GRN
//
// Quantities are deliberately 1 per set on a 1-unit order: the point is to walk
// every document type, not to test arithmetic, and small numbers keep the
// stock footprint on prod tiny.
//
// Every step records a row. A step that cannot proceed records BLOCKED with
// the reason and the run carries on, so the report always says how far a
// mixed-type assembly actually gets today.
//
// WRITES TO PROD (authorized, same as the other flow-* specs).
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@bommulti"

test.describe.configure({ mode: 'serial' });

const CLIENT_CODE = 'CLI-009';
const CLIENT_MATCH = /Arindam Engineering/i;

const PARENT = '554117165000';
const PARENT_NAME = /SINGLE FIRE CHECK LEVER/i;

interface Child {
  code: string;
  name: RegExp;
  type: 'manufacture' | 'purchase' | 'outsource';
}
const CHILDREN: Child[] = [
  { code: '554117144000', name: /COVER/i, type: 'manufacture' },
  { code: '554117221000', name: /ARM/i, type: 'manufacture' },
  { code: '554117155000', name: /THREADED HOUSING/i, type: 'purchase' },
  { code: '554117146000', name: /LEVER CATCH RAMMER/i, type: 'outsource' },
];
const MFG = CHILDREN.filter((c) => c.type === 'manufacture');

const SO_QTY = 1;
const RATE = 1200;
const TAG = `E2E-MULTI-${Date.now()}`;

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
function log(s: string): void {
  // eslint-disable-next-line no-console
  console.log(`>> ${s}`);
}

const state = {
  bomNo: process.env['E2E_M_BOM'] ?? '',
  soCode: process.env['E2E_M_SO'] ?? '',
  // E2E_M_JC lets a single step be re-run without replaying the whole chain.
  jcCodes: (process.env['E2E_M_JC'] ?? '').split(',').filter(Boolean),
  prCodes: [] as string[],
  poCodes: [] as string[],
  grnCodes: [] as string[],
  dspCode: '',
  invCode: '',
};

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

/** Every distinct code on the page matching `re`. Always forces the global
 *  flag: without it String.match returns [firstMatch, ...captureGroups], which
 *  reported a PR list of "IN-JWPR-00041, JW" — the second entry was the (JW)
 *  capture group, not a document. */
async function codesOnPage(page: Page, re: RegExp): Promise<string[]> {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...new Set((await page.locator('body').innerText()).match(g) ?? [])];
}

/** Fill an op row in the Edit Plan modal: name + machine, picked properly. */
async function fillPlanOp(page: Page, rowIdx: number, opName: string): Promise<void> {
  const rows = page.locator('table.ops-routing tbody tr');
  await rows.nth(rowIdx).getByPlaceholder('Operation name').fill(opName);
  // Machine is a real combobox with its own listbox — ArrowDown+Enter raced the
  // server fetch and left the row with no machine, which fails validation with
  // "In-house ops need a machine" and quietly blocks the finalize.
  const mach = rows.nth(rowIdx).locator('input[role="combobox"]').first();
  await mach.click();
  await mach.fill('CNC');
  const listboxId = await mach.getAttribute('aria-controls');
  const opt = page.locator(`#${listboxId} [role="option"]`).first();
  await expect(opt, 'a machine to pick').toBeVisible({ timeout: 20_000 });
  await opt.click();
  await page.waitForTimeout(600);
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

interface PlanCard {
  code: string;
  /** Mfg | Buy | OSP — the card's own label, not the BOM line type. */
  kind: string;
  status: string;
  text: string;
}

// Read the plan cards off the planning workflow page. The card shows the PLN
// code and a Mfg/Buy/OSP label but NOT the child item code, so anything that
// tries to find "the plan for item X" by text will silently match nothing —
// which is exactly how step 04 reported "no Edit on the plan" while all four
// plans existed.
async function readPlanCards(page: Page): Promise<PlanCard[]> {
  const spans = page.locator('span.mono.fw-700').filter({ hasText: /^PLN-\d+$/ });
  const out: PlanCard[] = [];
  for (let i = 0; i < (await spans.count()); i++) {
    const code = ((await spans.nth(i).textContent()) ?? '').trim();
    const text = ((await spans.nth(i).locator('xpath=..').innerText()) ?? '').replace(/\s+/g, ' ');
    const kind = /\bBuy\b/.test(text) ? 'Buy' : /\bOSP\b/.test(text) ? 'OSP' : 'Mfg';
    const status = (text.match(/In Planning|Planned|JC Created|PR Created|In Production|Complete/) ??
      ['?'])[0];
    out.push({ code, kind, status, text });
  }
  return out;
}

/** Click a named button inside the card that carries this PLN code. */
async function planCardButton(page: Page, code: string, name: RegExp) {
  const card = page.locator('span.mono.fw-700').filter({ hasText: code }).first().locator('xpath=..');
  return card.getByRole('button', { name });
}

async function openSoInPlanning(page: Page): Promise<void> {
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByPlaceholder(/Search/i).first().fill(state.soCode);
  await page.waitForTimeout(2500);
  await page.getByText(state.soCode).first().click();
  await page.waitForTimeout(3000);
}

// ───────────────────────────────────────────────────────────────────────────

test('@bommulti 01 — BOM with four children across three types', async ({ page }) => {
  if (state.bomNo) {
    record({ step: '01', doc: 'BOM', code: state.bomNo, qty: '—', status: 'reused', note: 'E2E_M_BOM' });
    return;
  }
  await page.goto('/bom-masters/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.bomNo = await page.locator('input[value^="BOM-"]').first().inputValue().catch(() => '');
  await page.getByPlaceholder(/Hydraulic Press Assembly/i).fill(`${TAG} multi`);

  await pickInto(page, 'bom-parent-item', PARENT);
  await expect(page.getByPlaceholder('auto-filled').first()).toHaveValue(PARENT_NAME, {
    timeout: 15_000,
  });

  const addChild = page.getByRole('button', { name: /Add child item/i });
  for (const [idx, c] of CHILDREN.entries()) {
    await addChild.click();
    await page.waitForTimeout(600);
    await pickInto(page, `bom-item-${idx}`, c.code);
    await expect(page.getByPlaceholder('auto-filled').nth(idx + 1)).toHaveValue(c.name, {
      timeout: 15_000,
    });
    const row = page.locator('.bomx-row').nth(idx + 1);
    await row.locator('input[type="number"]').fill('1');
    await row.locator('select').selectOption(c.type);
    await expect(row.locator('select')).toHaveValue(c.type);
  }
  await expect(page.getByText(`${CHILDREN.length} of ${CHILDREN.length} lines filled`)).toBeVisible();

  await page.getByRole('button', { name: /Save BOM/i }).click();
  await page.waitForTimeout(5000);
  const err = await bannerText(page);
  expect(page.url(), `BOM save rejected: ${err}`).not.toContain('/bom-masters/new');
  if (!state.bomNo) state.bomNo = (await codesOnPage(page, /BOM-\d+/))[0] ?? '';

  record({
    step: '01',
    doc: 'BOM',
    code: state.bomNo,
    qty: '1 per set × 4',
    status: 'active',
    note: `parent ${PARENT} · ${CHILDREN.map((c) => `${c.code}:${c.type}`).join(' · ')}`,
  });
});

test('@bommulti 02 — equipment SO, BOM attaches itself', async ({ page }) => {
  if (state.soCode) {
    record({ step: '02', doc: 'SO', code: state.soCode, qty: `${SO_QTY}`, status: 'reused', note: 'E2E_M_SO' });
    return;
  }
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.soCode = await page.locator('input[value^="IN-SO-"]').first().inputValue().catch(() => '');

  await page.locator('select.innovic-select').first().selectOption('equipment');
  await page.waitForTimeout(2500);
  await pickByPlaceholder(page, /Type client code or name/i, CLIENT_CODE, CLIENT_MATCH);
  await page.getByPlaceholder(/Client PO reference/i).fill(TAG);
  await page.locator('input[name="lines.0.itemCodeText"]').fill(PARENT);
  await page.waitForTimeout(2500);

  const note = page.locator('text=/attached automatically for/');
  await expect(note, 'the parent finds its own BOM').toBeVisible({ timeout: 20_000 });
  const noteText = ((await note.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  log(noteText);
  expect(noteText).toContain(state.bomNo);
  expect(noteText, 'all four children counted').toContain('4 parts');

  const nums = page.locator('input[type="number"]:visible');
  await nums.nth(0).fill(String(SO_QTY));
  await nums.nth(1).fill(String(RATE)).catch(() => {});
  await page.getByRole('button', { name: /Save SO/i }).click();
  await page.waitForTimeout(6000);
  const err = await bannerText(page);
  expect(page.url(), `SO save rejected: ${err}`).toMatch(/sales-orders\/[0-9a-f]{8}-/);
  if (!state.soCode) state.soCode = (await codesOnPage(page, /IN-SO-\d+/))[0] ?? '';

  record({
    step: '02',
    doc: 'Sales Order (equipment)',
    code: state.soCode,
    qty: `${SO_QTY} @ ₹${RATE}`,
    status: 'open',
    note: `${PARENT} · BOM ${state.bomNo} (4 parts)`,
  });
});

test('@bommulti 03 — explode into one plan per child', async ({ page }) => {
  await openSoInPlanning(page);
  const bomBtn = page.getByRole('button', { name: /BOM Planning/i }).first();
  if ((await bomBtn.count()) === 0) {
    record({ step: '03', doc: 'Plans', code: '—', qty: '—', status: 'BLOCKED', note: 'no BOM Planning button' });
    return;
  }
  await bomBtn.click();
  await page.waitForTimeout(3000);

  const boxes = page.locator('table input[type="checkbox"]:not([disabled])');
  for (let i = 0; i < (await boxes.count()); i++) {
    if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
  }
  const qtys = page.locator('table input[type="number"]:not([disabled])');
  for (let i = 0; i < (await qtys.count()); i++) {
    if (Number(await qtys.nth(i).inputValue()) <= 0) await qtys.nth(i).fill(String(SO_QTY));
  }
  await page.waitForTimeout(800);

  // Buy + Outsource children need a vendor before they can be planned.
  for (const c of CHILDREN) {
    if (c.type === 'manufacture') continue;
    const picker = page.locator(`#bomplan-vendor-${c.code}`);
    if ((await picker.count()) === 0) continue;
    await picker.click();
    await page.waitForTimeout(1200);
    const opt = page.locator(`#bomplan-vendor-${c.code}-listbox [role="option"]`).first();
    await expect(opt, `a vendor for ${c.code}`).toBeVisible({ timeout: 20_000 });
    log(`${c.code} (${c.type}) → ${((await opt.textContent()) ?? '').trim()}`);
    await opt.click();
    await page.waitForTimeout(500);
  }

  await page.getByRole('button', { name: /Create|Plan/i }).last().click();
  await page.waitForTimeout(6000);
  const err = await bannerText(page);
  if (err) log(`planning said: "${err}"`);

  // Re-open the SO rather than reloading: a bare reload leaves the SO row
  // collapsed, so only the first card is in the DOM and a scrape under-counts.
  await openSoInPlanning(page);
  const cards = await readPlanCards(page);
  for (const c of cards) log(`plan ${c.code} · ${c.kind} · ${c.status}`);

  record({
    step: '03',
    doc: 'Child plans',
    code: cards.map((c) => `${c.code}(${c.kind})`).join(', ') || '—',
    qty: `${SO_QTY} each`,
    status: cards.length >= CHILDREN.length ? `${cards.length} created` : `only ${cards.length}`,
    note:
      cards.length >= CHILDREN.length
        ? `kinds: ${cards.map((c) => c.kind).join('/')}`
        : `err: ${err}`,
  });
});

test('@bommulti 04 — route + execute the manufacture plans into job cards', async ({ page }) => {
  await openSoInPlanning(page);
  const mfgPlans = (await readPlanCards(page)).filter((p) => p.kind === 'Mfg');
  log(`manufacture plans to route: ${mfgPlans.map((p) => p.code).join(', ') || '(none)'}`);

  for (const p of mfgPlans) {
    await openSoInPlanning(page);
    // A card offers Edit while In Planning and Execute once Planned — never
    // both. Requiring Edit reported "no Edit on PLN-0046" on plans that were
    // already finalized and simply needed executing.
    const edit = await planCardButton(page, p.code, /Edit/i);
    if ((await edit.count()) === 0) {
      const ready = await planCardButton(page, p.code, /Execute/i);
      if ((await ready.count()) > 0) {
        log(`${p.code} is already Planned — executing straight away`);
        await ready.click();
        await page.waitForTimeout(7000);
      } else {
        record({ step: '04', doc: 'Job Card', code: p.code, qty: '—', status: 'BLOCKED', note: `${p.code} offers neither Edit nor Execute (status ${p.status})` });
      }
      continue;
    }
    await edit.click();
    await page.waitForTimeout(2500);

    // A manufacture plan cannot be finalized with zero operations, and an
    // in-house op with no machine fails validation too — so (re)fill row 0
    // either way rather than trusting whatever a previous run left behind.
    const rows = page.locator('table.ops-routing tbody tr');
    if ((await rows.count()) === 0) {
      await page.getByRole('button', { name: /\+ Add Op$/ }).click();
      await page.waitForTimeout(900);
    }
    await fillPlanOp(page, 0, `${TAG} TURN`);

    await page.getByRole('button', { name: /Save Plan/i }).click();
    await page.waitForTimeout(4500);
    const saveErr = await bannerText(page);
    if (saveErr) log(`Save Plan on ${p.code} said: "${saveErr}"`);

    const exec = await planCardButton(page, p.code, /Execute/i);
    if ((await exec.count()) === 0) {
      record({ step: '04', doc: 'Job Card', code: p.code, qty: '—', status: 'BLOCKED', note: `no Execute after Save Plan: ${await bannerText(page)}` });
      continue;
    }
    await exec.click();
    await page.waitForTimeout(7000);
  }

  await openSoInPlanning(page);
  state.jcCodes = await codesOnPage(page, /IN-JC-\d{2}-\d+/);
  record({
    step: '04',
    doc: 'Job Cards',
    code: state.jcCodes.join(', ') || '—',
    qty: `${SO_QTY} each`,
    status: state.jcCodes.length > 0 ? `${state.jcCodes.length} created` : 'BLOCKED',
    note: `from ${mfgPlans.map((p) => p.code).join(' + ') || 'no Mfg plans'}`,
  });
});

test('@bommulti 05 — JOB CARD EDIT: qty, add op, remove op', async ({ page }) => {
  test.skip(state.jcCodes.length === 0, 'no job card to edit');
  const jc = state.jcCodes[0]!;

  await page.goto(`/job-cards?search=${jc}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText(jc).first().click();
  await page.waitForTimeout(3000);
  const editLink = page.getByRole('link', { name: /Edit/i }).first();
  if ((await editLink.count()) === 0) {
    record({ step: '05', doc: 'JC edit', code: jc, qty: '—', status: 'BLOCKED', note: 'no Edit link on the job card' });
    return;
  }
  await editLink.click();
  await page.waitForTimeout(3000);

  const notes: string[] = [];
  const EXTRA = `${TAG} EXTRA`;

  // Re-read the EDIT FORM, not the detail page. Searching the detail page's
  // text for "2" matched a "2" somewhere else entirely and reported a qty save
  // that never happened — the database still said 1. The edit form's own
  // inputs are the stored values.
  const openEdit = async (): Promise<void> => {
    await page.goto(`/job-cards?search=${jc}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByText(jc).first().click();
    await page.waitForTimeout(2500);
    await page.getByRole('link', { name: /Edit/i }).first().click();
    await page.waitForTimeout(3000);
  };
  const opNames = async (): Promise<string[]> => {
    const boxes = page.getByPlaceholder(/Operation name|QC process name/i);
    const out: string[] = [];
    for (let i = 0; i < (await boxes.count()); i++) out.push(await boxes.nth(i).inputValue());
    return out;
  };
  const save = async (): Promise<string> => {
    await page.getByRole('button', { name: /Save Job Card/i }).click();
    await page.waitForTimeout(5000);
    return bannerText(page);
  };

  // (a) Order Qty edit persists.
  const qtyBox = page.locator('input[type="number"]').first();
  const before = await qtyBox.inputValue();
  const target = String(Number(before || '1') + 1);
  await qtyBox.fill(target);
  const qtyErr = await save();
  await openEdit();
  const qtyNow = await page.locator('input[type="number"]').first().inputValue();
  const qtyOk = qtyNow === target;
  notes.push(`qty ${before}→${target}: ${qtyOk ? 'saved' : `NOT saved (reads ${qtyNow}${qtyErr ? `; ${qtyErr}` : ''})`}`);
  log(`JC edit — order qty ${before} → ${target}: form reads ${qtyNow} → ${qtyOk ? 'OK' : 'FAILED'}`);

  // (b) Adding an operation persists.
  const opsBefore = await opNames();
  await page.getByRole('button', { name: /\+ Add Op$/ }).click();
  await page.waitForTimeout(1200);
  await page.getByPlaceholder(/Operation name/i).last().fill(EXTRA);
  const mach = page.locator('input[role="combobox"]').last();
  await mach.click();
  await mach.fill('CNC');
  const machList = await mach.getAttribute('aria-controls');
  const machOpt = page.locator(`#${machList} [role="option"]`).first();
  if (await machOpt.isVisible().catch(() => false)) await machOpt.click();
  await page.waitForTimeout(700);
  const addErr = await save();
  await openEdit();
  const opsAfterAdd = await opNames();
  const addOk = opsAfterAdd.includes(EXTRA);
  notes.push(
    `add op: ${addOk ? 'saved' : `NOT saved (${opsBefore.length}→${opsAfterAdd.length} ops${addErr ? `; ${addErr}` : ''})`}`,
  );
  log(`JC edit — add op: ${opsBefore.length} → ${opsAfterAdd.length} ops [${opsAfterAdd.join(' | ')}] → ${addOk ? 'OK' : 'FAILED'}`);

  // (c) Removing that operation persists — only meaningful if (b) worked.
  if (addOk) {
    const idx = opsAfterAdd.indexOf(EXTRA);
    const delBtns = page.locator('button.btn-danger:not([disabled])');
    if (idx >= 0 && (await delBtns.count()) > idx) {
      await delBtns.nth(idx).click();
      await page.waitForTimeout(900);
      const delErr = await save();
      await openEdit();
      const opsAfterDel = await opNames();
      const delOk = !opsAfterDel.includes(EXTRA);
      notes.push(`remove op: ${delOk ? 'removed' : `STILL THERE${delErr ? ` (${delErr})` : ''}`}`);
      log(`JC edit — remove op: now [${opsAfterDel.join(' | ')}] → ${delOk ? 'OK' : 'FAILED'}`);
    } else {
      notes.push('remove op: no enabled delete control for that row');
    }
  } else {
    notes.push('remove op: skipped — the add never persisted');
  }

  record({
    step: '05',
    doc: 'Job Card edits',
    code: jc,
    qty: `qty ${before} → ${target}`,
    status: notes.every((n) => /: saved|: removed/.test(n)) ? 'all passed' : 'FAILURES',
    note: notes.join(' · '),
  });
});

test('@bommulti 06 — produce and QC both manufacture children', async ({ page }) => {
  test.skip(state.jcCodes.length === 0, 'no job cards');
  const done: string[] = [];
  for (const jc of state.jcCodes) {
    await page.goto('/op-entry', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await page.getByPlaceholder(/IN-JC-/i).fill(jc);
    await page.getByRole('button', { name: /^Load$/ }).click();
    await page.waitForTimeout(4000);

    const qty = Number(
      ((await page.locator('body').innerText()).match(/PENDING\s+(\d+)/) ?? ['', '1'])[1],
    );
    const processOp = page.getByText(new RegExp(`${TAG}|TURN|Machining|Turning`, 'i')).first();
    if ((await processOp.count()) > 0) {
      await processOp.click();
      await page.waitForTimeout(1500);
      await page.getByRole('spinbutton').first().fill(String(qty || 1));
      await page.getByPlaceholder(/Operator name/i).fill('E2E Auto').catch(() => {});
      await page.getByRole('button', { name: /Submit completion/i }).click();
      await page.waitForTimeout(4000);
    }
    const qcOp = page.getByText('DIR', { exact: true }).first();
    if ((await qcOp.count()) > 0) {
      await qcOp.click();
      await page.waitForTimeout(1800);
      await page.getByRole('spinbutton').first().fill(String(qty || 1));
      await page.getByRole('button', { name: /Submit QC inspection/i }).click();
      await page.waitForTimeout(4500);
    }
    const txt = await page.locator('body').innerText();
    done.push(`${jc}:${/complete/i.test(txt) ? 'complete' : 'logged'}`);
    log(`op entry ${jc} → ${done[done.length - 1]}`);
  }
  record({
    step: '06',
    doc: 'Op Entry + QC',
    code: state.jcCodes.join(', '),
    qty: `${SO_QTY} each`,
    status: 'done',
    note: done.join(' · '),
  });
});

test('@bommulti 07 — execute the buy + outsource plans into PRs', async ({ page }) => {
  await openSoInPlanning(page);
  const before = await codesOnPage(page, /IN-(?:JW)?PR-\d+/);

  const procure = (await readPlanCards(page)).filter((p) => p.kind === 'Buy' || p.kind === 'OSP');
  log(`buy/outsource plans: ${procure.map((p) => `${p.code}(${p.kind})`).join(', ') || '(none)'}`);

  for (const p of procure) {
    // Already executed — a PR/JC exists. Re-opening Edit on those just spins.
    if (/PR Created|JC Created|In Production|Complete/.test(p.status)) {
      log(`${p.code} (${p.kind}) already executed — status ${p.status}`);
      continue;
    }
    await openSoInPlanning(page);
    const edit = await planCardButton(page, p.code, /Edit/i);
    if ((await edit.count()) > 0) {
      // Buy / Outsource plans need no ops — Save Plan just finalizes them.
      await edit.click();
      await page.waitForTimeout(2500);
      await page.getByRole('button', { name: /Save Plan/i }).click();
      await page.waitForTimeout(4500);
      const saveErr = await bannerText(page);
      if (saveErr) log(`Save Plan on ${p.code} (${p.kind}) said: "${saveErr}"`);
    }
    const exec = await planCardButton(page, p.code, /Execute/i);
    if ((await exec.count()) > 0) {
      await exec.click();
      await page.waitForTimeout(7000);
    } else {
      log(`no Execute for ${p.code} (${p.kind}): ${await bannerText(page)}`);
    }
  }

  await openSoInPlanning(page);
  const after = await codesOnPage(page, /IN-(?:JW)?PR-\d+/);
  state.prCodes = after.filter((p) => !before.includes(p));
  log(`PRs raised: ${state.prCodes.join(', ') || '(none new)'} (page shows ${after.join(', ')})`);
  record({
    step: '07',
    doc: 'Purchase Requests',
    code: (state.prCodes.length ? state.prCodes : after).join(', ') || '—',
    qty: `${SO_QTY} each`,
    status: after.length > 0 ? 'raised' : 'BLOCKED',
    note: 'buy + outsource children',
  });
});

test('@bommulti 08 — PR → PO', async ({ page }) => {
  const prs = state.prCodes.length ? state.prCodes : [];
  test.skip(prs.length === 0, 'no PRs raised');
  for (const pr of prs) {
    await page.goto(`/purchase-requests?search=${pr}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const row = page.getByText(pr).first();
    if ((await row.count()) === 0) {
      log(`${pr} not on the PR register`);
      continue;
    }
    await row.click();
    await page.waitForTimeout(2500);
    const mk = page.getByRole('button', { name: /Create PO|Convert to PO|Make PO/i }).first();
    const mkLink = page.getByRole('link', { name: /Create PO|Convert to PO|Make PO/i }).first();
    const target = (await mk.count()) > 0 ? mk : (await mkLink.count()) > 0 ? mkLink : null;
    if (!target) {
      log(`no "create PO" control on ${pr}: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 260)}`);
      continue;
    }
    await target.click();
    await page.waitForTimeout(3500);
    const save = page.getByRole('button', { name: /Save PO|Create PO/i }).first();
    if ((await save.count()) > 0) {
      await save.click();
      await page.waitForTimeout(5000);
    }
    log(`after PO attempt for ${pr}: ${page.url()} — ${await bannerText(page)}`);
  }
  await page.goto('/purchase-orders', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  state.poCodes = await codesOnPage(page, /IN-PO-\d+/);
  record({
    step: '08',
    doc: 'Purchase Orders',
    code: state.poCodes.slice(0, 4).join(', ') || '—',
    qty: '—',
    status: state.poCodes.length > 0 ? 'register has POs' : 'BLOCKED',
    note: 'converted from the child PRs',
  });
});

test('@bommulti 09 — dispatch what the assembly can actually ship', async ({ page }) => {
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
    record({ step: '09', doc: 'Dispatch', code: '—', qty: '—', status: 'BLOCKED', note: `${state.soCode} not offered` });
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

  const dqty = page.locator('input[type="number"]').last();
  const max = await dqty.getAttribute('max').catch(() => null);
  log(`dispatch cap: ${max ?? '(none)'}`);
  if (max === '0' || !(await dqty.isEnabled())) {
    record({
      step: '09',
      doc: 'Dispatch',
      code: '—',
      qty: `cap ${max ?? 'n/a'}`,
      status: 'BLOCKED',
      note: 'weakest component is 0 — the bought/outsourced children have not been received',
    });
    return;
  }
  await dqty.fill(String(SO_QTY));
  await page.getByRole('button', { name: /Create Dispatch/i }).click();
  await page.waitForTimeout(5000);
  state.dspCode = (await codesOnPage(page, /DSP-\d+/))[0] ?? '';
  record({
    step: '09',
    doc: 'Customer Dispatch',
    code: state.dspCode || '—',
    qty: `${SO_QTY}`,
    status: state.dspCode ? 'issued' : 'BLOCKED',
    note: state.dspCode ? `cap was ${max}` : `refused: ${await bannerText(page)}`,
  });
});

test('@bommulti 10 — invoice', async ({ page }) => {
  test.skip(!state.dspCode, 'nothing dispatched');
  await page.goto('/invoices/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const sels = page.locator('select');
  for (let s = 0; s < (await sels.count()); s++) {
    const opts = await sels.nth(s).locator('option').allInnerTexts();
    const idx = opts.findIndex((t) => t.includes(state.soCode));
    if (idx >= 0) {
      await sels.nth(s).selectOption({ index: idx });
      break;
    }
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
  const nums = page.locator('input[type="number"]');
  for (let k = 0; k < (await nums.count()); k++) {
    if (!(await nums.nth(k).isEditable().catch(() => false))) continue;
    if ((await nums.nth(k).inputValue()) === '') {
      await nums.nth(k).fill(String(SO_QTY));
      break;
    }
  }
  await page.getByRole('button', { name: /Create Invoice/i }).click();
  await page.waitForTimeout(5000);
  state.invCode = (await codesOnPage(page, /INV-\d+/))[0] ?? '';
  record({
    step: '10',
    doc: 'Invoice',
    code: state.invCode || '—',
    qty: `${SO_QTY} × ₹${RATE}`,
    status: state.invCode ? 'raised' : 'BLOCKED',
    note: state.invCode ? '' : `refused: ${await bannerText(page)}`,
  });
});

test('@bommulti 99 — report', async () => {
  const w = [4, 24, 30, 22, 18];
  const line = (c: string[]): string =>
    '| ' + c.map((s, i) => s.padEnd(w[i] ?? 20)).join(' | ') + ' |';
  // eslint-disable-next-line no-console
  console.log('\n\n===== MULTI-ITEM MIXED-TYPE BOM → INVOICE =====');
  // eslint-disable-next-line no-console
  console.log(line(['#', 'Document', 'Code', 'Qty', 'Status']));
  for (const r of REPORT) {
    // eslint-disable-next-line no-console
    console.log(line([r.step, r.doc, r.code, r.qty, r.status]));
    // eslint-disable-next-line no-console
    if (r.note) console.log(`     ↳ ${r.note}`);
  }
  // eslint-disable-next-line no-console
  console.log('================================================\n');
  expect(REPORT.length).toBeGreaterThan(4);
});
