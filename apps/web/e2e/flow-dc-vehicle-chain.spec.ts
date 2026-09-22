import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ONE-TIME TEST-DATA BUILDER for the Delivery Challan "Vehicle No" feature.
 *
 * This file CREATES REAL RECORDS IN THE PRODUCTION DATABASE. It is not a
 * feature test — it exists only because the Vehicle No round trip
 * (flow-dc-vehicle-no.spec.ts) needs a Job Work PO that still has material
 * available to send, and no such PO existed.
 *
 * Everything it builds is its own. It never advances, approves, edits or
 * cancels a record that already existed. It reuses MASTERS only (client,
 * item, vendor) because masters are permanent reference data.
 *
 * ─── THE CHAIN, AND WHY IT IS THIS SHORT ───────────────────────────────────
 *   1. Sales Order            — one line, 2 pcs, ₹1/pc
 *   2. Plan (Planning screen) — manufacture, ONE operation, an OUTSOURCE op
 *   3. ⚡ Execute the plan     — creates the Job Card AND auto-raises the
 *                               job-work PR (apps/api/src/modules/plans/
 *                               service.ts executeManufacture: every
 *                               op_type='outsource' op gets a jw_osp PR and is
 *                               stamped outsource_status='pr_raised')
 *   4. PR → PO                — /purchase-orders/from-pr. PRs convert straight
 *                               to an OPEN PO (service.ts L1181 "PRs only
 *                               convert to open POs (skip draft state)"), and
 *                               only a non-draft job_work PO is dispatchable.
 *
 * The single operation is deliberately at op_seq 1. public.v_jc_op_status
 * computes `input_avail` as `CASE WHEN op_seq = 1 THEN jc_order_qty`, so a
 * first-op outsource has the full order qty available and the ADR-078 outward
 * guard in delivery-challans/cascades.ts lets it ship. That is why NO
 * operations have to be walked, no QC has to be passed, and no other job card
 * is touched. It is the smallest chain that legitimately reaches a DC.
 *
 * ─── RUN IT ONCE ───────────────────────────────────────────────────────────
 *   npx playwright test --config=playwright.pages.config.ts \
 *     e2e/flow-dc-vehicle-chain.spec.ts --reporter=list
 *
 * It refuses to run a second time unless E2E_CHAIN_REBUILD=1, so a stray
 * re-run cannot quietly litter production with duplicate sales orders.
 *
 * It writes the codes it created to e2e/.artifacts/dc-chain.json and prints
 * them. flow-dc-vehicle-no.spec.ts reads that file, so no environment variable
 * has to be edited by hand.
 */

// ─── Markers ────────────────────────────────────────────────────────────────
// Document numbers are format-locked (IN-SO-#####, IN-JC-26-#####, IN-JWPR-#####,
// IN-PO-#####) and cannot carry a prefix, so the E2E_ marker goes into every
// free-text field the chain touches. These are the strings to search for.
const SO_CLIENT_PO_NO = 'E2E_VEHICLE_NO_TEST';
const SO_REMARKS = 'E2E_ Vehicle-No feature verification — test data, safe to cancel';
const OSP_OPERATION = 'E2E_OSP_TESTPROC';

// ─── Masters reused (never created) ─────────────────────────────────────────
const CLIENT_CODE = 'CLI-003'; // AIRKING ENTERPRISE
const ITEM_CODE = '554117144000'; // COVER
const VENDOR_CODE = 'VND-614'; // Master Profile Gauges — already a job-work vendor here

// ─── Sizing ─────────────────────────────────────────────────────────────────
// 2 pcs so the later DC can send 1 and leave 1: that makes the send a genuine
// partial, and leaves the operation short of complete, which is the safest
// state to cancel back out of.
const ORDER_QTY = '2';
const RATE = '1';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '.artifacts', 'dc-chain.json');

/**
 * Picks an option out of a SearchableSelect.
 *
 * Two things make this fiddly and both are load-bearing:
 *  - the dropdown is portaled to <body> as #<id>-listbox, so it is NOT a DOM
 *    descendant of the input and cannot be reached by walking up from it;
 *  - typing into the input clears the stored id (handleInput does
 *    `if (value) onChange(null)`), so the pick must always end on an option.
 */
async function pickFromSearchable(
  page: Page,
  inputId: string,
  query: string,
  optionText: string,
): Promise<void> {
  const input = page.locator(`#${inputId}`);
  await expect(input, `searchable select #${inputId} is on the page`).toBeVisible({
    timeout: 30_000,
  });
  await input.click();
  await input.fill(query);
  const listbox = page.locator(`#${inputId}-listbox`);
  await expect(listbox, `#${inputId} opened its dropdown for "${query}"`).toBeVisible({
    timeout: 30_000,
  });
  const option = listbox.getByRole('option').filter({ hasText: optionText }).first();
  await expect(option, `"${optionText}" is offered in the #${inputId} dropdown`).toBeVisible({
    timeout: 30_000,
  });
  await option.click();
  await expect(listbox, `the #${inputId} dropdown closed after picking`).toBeHidden({
    timeout: 20_000,
  });
}

/**
 * Waits for a save to navigate, and if it does not, reports what the app put on
 * screen instead of a bare "waitForURL timed out". A refusal from the ERP is
 * information — it is usually the app correctly rejecting bad input — and it
 * should never be swallowed.
 */
async function expectNavigationAfterSave(
  page: Page,
  urlPattern: RegExp,
  what: string,
): Promise<void> {
  try {
    await page.waitForURL(urlPattern, { timeout: 90_000 });
  } catch {
    const messages = await page
      .locator('.form-error, .pof-msg, .pof-note-bad, [class*="error"]')
      .allInnerTexts();
    const shown = messages.map((m) => m.trim()).filter(Boolean);
    throw new Error(
      `${what} did not save — the app stayed on the form. ` +
        `Message(s) on screen: ${shown.length ? shown.join(' | ') : '(none found; see the trace)'}`,
    );
  }
}

test('build the E2E_ SO → Job Card → Job Work PO chain the Vehicle No test needs', async ({
  page,
}) => {
  test.setTimeout(600_000);

  // ── Guard: one run only. ─────────────────────────────────────────────────
  // Every step below is a permanent write to the live database. Re-running
  // would create a SECOND sales order, job card, PR and PO. If the chain has
  // to be rebuilt that must be a deliberate act.
  //
  // The guard keys off the artifact this file writes, NOT off E2E_DC_PO_CODE:
  // that variable is pre-set in .env.e2e to IN-PO-00001, a pre-existing PO
  // belonging to somebody else's job card, which this chain exists precisely
  // to avoid consuming.
  if (existsSync(ARTIFACT) && process.env.E2E_CHAIN_REBUILD !== '1') {
    test.skip(
      true,
      `${ARTIFACT} already records a chain — it has been built. ` +
        'Set E2E_CHAIN_REBUILD=1 to deliberately build a second one.',
    );
  }

  const created: Record<string, string> = {};

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1 — Sales Order
  // ═══════════════════════════════════════════════════════════════════════
  await page.goto('/sales-orders/new', { waitUntil: 'domcontentloaded' });
  expect(
    await page.getByText(/do not have create access to SO Master/i).count(),
    'the E2E login needs entry access on SO Master (so_create)',
  ).toBe(0);

  // The doc number prefills asynchronously and Save stays disabled until the
  // duplicate check clears, so wait for the code before touching anything else.
  const soCodeInput = page.locator('#docno-sales_order');
  await expect(soCodeInput, 'the SO number prefilled').not.toHaveValue('', { timeout: 60_000 });
  const soCode = await soCodeInput.inputValue();
  expect(soCode, 'the SO number matches IN-SO-#####').toMatch(/^IN-SO-\d{5}$/);
  created.salesOrder = soCode;

  await page.locator('#type').selectOption('component_manufacturing');
  await pickFromSearchable(page, 'clientId', CLIENT_CODE, CLIENT_CODE);

  // Client PO No. is required unless an Email Ref file is attached, and it is
  // free text — so it doubles as the SO's E2E_ marker.
  await page.locator('#clientPoNo').fill(SO_CLIENT_PO_NO);
  await page.locator('#remarks').fill(SO_REMARKS);

  // The create form already opens with ONE blank line
  // (sales-order-form.tsx: `lines: [{ ...NEW_LINE }]`). Clicking "Add Line"
  // here would leave a second, empty line behind and the form would refuse to
  // save with "Line 2: pick an Item Code from Item Master." So only add a row
  // if for some reason there is not one already.
  const soLineRows = page.locator('table.innovic-table tbody tr').filter({
    has: page.locator('input[name^="lines."]'),
  });
  if ((await soLineRows.count()) === 0) {
    // The button renders a <Plus> icon then the text " Add Line", so its
    // accessible name is "Add Line" — there is no literal "+" to match on.
    await page.getByRole('button', { name: /Add Line/ }).click();
  }
  await expect(soLineRows, 'exactly one SO line to fill in').toHaveCount(1);

  await pickFromSearchable(page, 'soln-ic-0', ITEM_CODE, ITEM_CODE);
  await page.locator('input[name="lines.0.orderQty"]').fill(ORDER_QTY);
  await page.locator('input[name="lines.0.rate"]').fill(RATE);

  const saveSo = page.getByRole('button', { name: 'Save SO' });
  await expect(saveSo, 'Save SO enabled once the code check cleared').toBeEnabled({
    timeout: 60_000,
  });
  // eslint-disable-next-line no-console
  console.log(`>> CREATING Sales Order ${soCode} — ${ORDER_QTY} pcs of ${ITEM_CODE}`);
  await saveSo.click();
  await expectNavigationAfterSave(page, /\/sales-orders\/[0-9a-f]{8}-/i, `Sales Order ${soCode}`);
  // eslint-disable-next-line no-console
  console.log(`>> CREATED  Sales Order ${soCode}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2 — Plan it (one OUTSOURCE operation, at op_seq 1)
  // ═══════════════════════════════════════════════════════════════════════
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  expect(
    await page.getByText(/hidden for your access/i).count(),
    'the E2E login needs access to Planning (plan_create)',
  ).toBe(0);

  await page.getByPlaceholder('🔍 Search SO / customer / item…').fill(soCode);
  // The SO code sits in a <span class="mono fw-700"> inside the row's onClick
  // <div>. Clicking the span bubbles to the row handler, which is far more
  // stable than trying to pick the right ancestor div out of the tree.
  const soRow = page.getByText(soCode, { exact: true }).first();
  await expect(soRow, `the planning list found ${soCode}`).toBeVisible({ timeout: 60_000 });
  await soRow.click();

  const planBtn = page.getByRole('button', { name: /^\+ Plan \d+ pcs$/ });
  await expect(planBtn, `${soCode} has an unplanned line to plan`).toBeVisible({
    timeout: 60_000,
  });
  await planBtn.click();

  // ── Create Plan modal. The Plan Qty input carries no id, so scope it by the
  //    label sitting in the same .form-grp. (#reserve-qty is a different box
  //    and only renders when there is free stock — do not confuse the two.)
  const planQty = page
    .locator('.modal .form-grp')
    .filter({ hasText: 'Plan Qty' })
    .locator('input[type="number"]')
    .first();
  await expect(planQty, 'the Create Plan modal opened').toBeVisible({ timeout: 30_000 });
  await planQty.fill(ORDER_QTY);
  await page.locator('.modal-footer').getByRole('button', { name: 'Save' }).click();

  // ── Edit Plan modal opens automatically, chained from the create.
  const addOsp = page.getByRole('button', { name: '+ Add OSP Op' });
  await expect(addOsp, 'the Edit Plan modal opened with its ops panel').toBeVisible({
    timeout: 60_000,
  });

  // Ops default-load from the item's route card. There are no route cards in
  // this database, so the list should be empty — but clear it anyway rather
  // than assume, because a stray default op would push the outsource step off
  // op_seq 1 and there would be no material on it.
  const opRows = page.locator('table.ops-routing tbody tr');
  for (let guard = 0; guard < 30 && (await opRows.count()) > 0; guard += 1) {
    await opRows.first().getByRole('button', { name: '×' }).click();
  }
  await expect(opRows, 'the plan starts with no operations').toHaveCount(0);

  await addOsp.click();
  await expect(opRows, 'one outsource operation was added').toHaveCount(1);

  await page.getByPlaceholder('Operation name').first().fill(OSP_OPERATION);

  // The OSP vendor picker's id embeds a per-op random uid, so read it off the
  // DOM rather than guessing.
  const vendorSelect = page.locator('[id^="plan-osp-vend-"]').first();
  await expect(vendorSelect, 'the outsource row revealed its vendor picker').toBeVisible({
    timeout: 30_000,
  });
  const vendorId = await vendorSelect.getAttribute('id');
  expect(vendorId, 'the vendor picker has an id to target').toBeTruthy();
  await pickFromSearchable(page, vendorId!, VENDOR_CODE, VENDOR_CODE);

  // "✓ Save Plan" = updatePlan + finalizePlan → status 'planned', which is the
  // only status Execute accepts. "Save Draft" would leave it in_planning.
  await page.getByRole('button', { name: '✓ Save Plan' }).click();

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3 — Execute → Job Card + auto-raised job-work PR
  // ═══════════════════════════════════════════════════════════════════════
  const execBtn = page.getByRole('button', { name: /Execute/ });
  await expect(execBtn, 'the saved plan offers ⚡ Execute').toBeVisible({ timeout: 60_000 });
  // eslint-disable-next-line no-console
  console.log('>> EXECUTING the plan — this creates the Job Card and the job-work PR');
  await execBtn.click();

  // On success the card flips to jc_created and shows the JC code, plus the
  // OSP PR that executeManufacture raised for the outsource op.
  const prLink = page.getByRole('link', { name: /IN-JWPR-\d+/ }).first();
  await expect(prLink, 'executing the plan auto-raised the job-work PR').toBeVisible({
    timeout: 120_000,
  });
  const prCode = (await prLink.innerText()).trim();
  created.purchaseRequest = prCode;

  const jcBtn = page.getByRole('button', { name: /IN-JC-\d{2}-\d+/ }).first();
  if (await jcBtn.count()) {
    created.jobCard = (await jcBtn.innerText()).trim();
  }
  // eslint-disable-next-line no-console
  console.log(`>> CREATED  Job Card ${created.jobCard ?? '(code not shown)'} and PR ${prCode}`);

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 4 — PR → job-work PO
  // ═══════════════════════════════════════════════════════════════════════
  await prLink.click();
  await page.waitForURL(/\/purchase-requests\/[0-9a-f]{8}-/i, { timeout: 60_000 });

  const createPo = page.getByRole('link', { name: /Create PO/i });
  await expect(createPo, 'the PR detail offers Create PO').toBeVisible({ timeout: 60_000 });
  await createPo.click();
  await page.waitForURL(/\/purchase-orders\/from-pr/, { timeout: 60_000 });

  const poCodeInput = page.locator('#pof-code');
  await expect(poCodeInput, 'the PO number prefilled').not.toHaveValue('', { timeout: 60_000 });
  const poCode = await poCodeInput.inputValue();
  expect(poCode, 'the PO number matches IN-PO-#####').toMatch(/^IN-PO-\d{5}$/);
  created.purchaseOrder = poCode;

  // job_work is the default and is what makes the PO dispatchable
  // (poSendsMaterialOut). Set it explicitly so a changed default cannot
  // silently produce a PO the DC screen will not list.
  await page.locator('#pof-type').selectOption('job_work');
  await page.locator('#pof-remarks').fill(SO_REMARKS);

  const submitPo = page.getByRole('button', { name: /Create PO/ });
  await expect(submitPo, 'Create PO enabled once the number check cleared').toBeEnabled({
    timeout: 60_000,
  });
  // eslint-disable-next-line no-console
  console.log(`>> CREATING job-work PO ${poCode} from ${prCode}`);
  await submitPo.click();
  await expectNavigationAfterSave(page, /\/purchase-orders\/[0-9a-f]{8}-/i, `Purchase Order ${poCode}`);

  // ── Prove it is actually dispatchable, rather than hoping. A PO only reaches
  //    the DC picker when it is job_work/service AND not draft/cancelled.
  await expect(
    page.getByText(poCode, { exact: false }).first(),
    'landed on the new PO',
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('link', { name: /Issue DC/i }),
    'the new PO offers "Issue DC" — i.e. it is a non-draft job-work PO the ' +
      'delivery challan screen will list',
  ).toBeVisible({ timeout: 30_000 });

  // ═══════════════════════════════════════════════════════════════════════
  // Hand the codes over.
  // ═══════════════════════════════════════════════════════════════════════
  mkdirSync(dirname(ARTIFACT), { recursive: true });
  writeFileSync(ARTIFACT, JSON.stringify(created, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log(
    '\n================ CHAIN BUILT IN PRODUCTION ================\n' +
      `  Sales Order      ${created.salesOrder}   (Client PO No. = ${SO_CLIENT_PO_NO})\n` +
      `  Job Card         ${created.jobCard ?? '(read it off the plan card)'}\n` +
      `  Job Work PR      ${created.purchaseRequest}\n` +
      `  Job Work PO      ${created.purchaseOrder}\n` +
      `  Operation        ${OSP_OPERATION} (op 1, outsource, vendor ${VENDOR_CODE})\n` +
      `\n  Recorded in ${ARTIFACT}\n` +
      '  flow-dc-vehicle-no.spec.ts picks it up from there.\n' +
      '==========================================================\n',
  );
});
