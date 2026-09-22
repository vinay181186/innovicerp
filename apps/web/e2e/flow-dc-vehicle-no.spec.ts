import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vehicle No on the Delivery Challan.
 *
 * WHAT THIS FEATURE FIXED, AND THEREFORE WHAT MATTERS HERE
 * -------------------------------------------------------
 * There used to be no vehicle field at all. People typed the vehicle number
 * into the Transporter box, and print-ospdc.ts read that same value back out
 * under a variable called `vehicleNo` — so the printed challan showed a
 * transporter's NAME where the vehicle registration belonged.
 *
 * The column delivery_challans.vehicle_no (text, nullable) now exists and the
 * two are separate fields end to end. So the assertion that carries the whole
 * feature is not "the vehicle saved" — it is:
 *
 *     TRANSPORTER AND VEHICLE ARE TWO INDEPENDENT VALUES THAT NEVER CROSS.
 *
 * That is why the two strings below deliberately share no substring. If either
 * value ever appears in the other's field, the old bug is back.
 *
 * Contract (packages/shared/src/schemas/delivery-challan.ts):
 *   deliveryChallanSchema.vehicleNo                   : string | null
 *   createDeliveryChallanInputSchema.header.vehicleNo : string | null | undefined
 *
 * ─── HOW TO RUN ────────────────────────────────────────────────────────────
 * Against the DEPLOYED site only. The production API returns no
 * access-control-allow-origin for http://localhost:5173, so every data request
 * from a local dev server dies as "Couldn't reach the server". The deployed
 * origin https://innovic-erp.pages.dev is allowed.
 *
 *   npx playwright test --config=playwright.pages.config.ts \
 *     e2e/flow-dc-vehicle-no.spec.ts --reporter=list
 *
 * The file must stay named flow-*.spec.ts — that config's chromium project
 * only matches /flow-.*\.spec\.ts/.
 *
 * ─── THE SECOND TEST WRITES TO PRODUCTION ──────────────────────────────────
 * Test 2 creates one real Delivery Challan. Via
 * apps/api/src/modules/delivery-challans/cascades.ts (applyOutwardToJcOp) that
 * permanently moves a job-card operation forward:
 *     outsource_sent_qty += qty
 *     outsource_dc_no     = <the new DC code>
 *     outsource_status   → 'sent'
 *
 * It only ever does that to the job card THIS SUITE BUILT. The PO it consumes
 * comes from e2e/.artifacts/dc-chain.json, written by
 * flow-dc-vehicle-chain.spec.ts. It is NOT read from E2E_DC_PO_CODE, because
 * that variable is pinned in .env.e2e to IN-PO-00001 — a pre-existing PO that
 * feeds somebody else's job card and must never be consumed by a test.
 *
 * To undo: open the new challan and press "Cancel DC" (runs
 * reverseOutwardFromJcOp and puts the operation back). A SQL delete of the DC
 * row does NOT undo the cascade.
 *
 * Naming note: the DC code cannot carry the E2E_ marker — the document number
 * is format-locked to ^IN-DC-\d{5}$. The marker lives in Transporter, Vehicle
 * No, Material and Remarks instead, so the row stays findable.
 */

// Typed into Vehicle No.
const VEHICLE_NO = 'E2E_MH12AB1234';
// Typed into Transporter. Shares no substring with VEHICLE_NO, on purpose.
const TRANSPORTER = 'E2E_ROADWAYS_PVT_LTD';
const MATERIAL_TEXT = 'E2E_MATERIAL';
const REMARKS_TEXT = 'E2E_VEHICLE_NO_ROUNDTRIP';
// Smallest possible send. The job card has 2 pcs available, so this leaves 1.
const SEND_QTY = '1';

const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '.artifacts', 'dc-chain.json');

/**
 * The job-work PO this suite is allowed to send material against.
 *
 * Deliberately artifact-only. Falling back to E2E_DC_PO_CODE would silently
 * pick up IN-PO-00001 and dispatch a real customer's material.
 */
function ownPoCode(): string {
  let raw: string;
  try {
    raw = readFileSync(ARTIFACT, 'utf8');
  } catch {
    throw new Error(
      `No test chain found at ${ARTIFACT}. Build one first:\n` +
        '  npx playwright test --config=playwright.pages.config.ts ' +
        'e2e/flow-dc-vehicle-chain.spec.ts --reporter=list\n' +
        'This suite will not fall back to E2E_DC_PO_CODE — that is pinned to a ' +
        'pre-existing PO which is not ours to consume.',
    );
  }
  const code = (JSON.parse(raw) as { purchaseOrder?: string }).purchaseOrder;
  if (!code) throw new Error(`${ARTIFACT} has no purchaseOrder recorded.`);
  return code;
}

/**
 * Remembers the DC that was created, so the read-only tests below can be run
 * on their own later without having to re-run the one test that writes. Every
 * extra run of the write test would create another challan and consume another
 * piece of the job card's 2.
 */
function rememberDc(dcCode: string): void {
  const data = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as Record<string, string>;
  data.deliveryChallan = dcCode;
  writeFileSync(ARTIFACT, JSON.stringify(data, null, 2), 'utf8');
}

function rememberedDc(): string {
  const data = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as { deliveryChallan?: string };
  return data.deliveryChallan ?? '';
}

/** Reads the value rendered beside a label in the detail page's Pair grid. */
async function readPair(page: Page, label: string): Promise<string> {
  const group = page
    .locator('.form-grp')
    .filter({ has: page.getByText(label, { exact: true }) })
    .first();
  await expect(group, `the detail page shows a "${label}" field`).toBeVisible({
    timeout: 20_000,
  });
  return (await group.locator('div').first().innerText()).trim();
}

/**
 * The three assertions that ARE the feature. Kept in one place so the
 * post-save check and the cold-load check cannot drift apart.
 */
async function expectTransportAndVehicleAreSeparate(page: Page, where: string): Promise<void> {
  const vehicleShown = await readPair(page, 'Vehicle No');
  const transportShown = await readPair(page, 'Transport');
  // eslint-disable-next-line no-console
  console.log(`>> ${where} — Transport: "${transportShown}" | Vehicle No: "${vehicleShown}"`);

  // 1. Each value survived byte-for-byte.
  expect(vehicleShown, `${where}: Vehicle No is exactly what was typed`).toBe(VEHICLE_NO);
  expect(transportShown, `${where}: Transport is exactly what was typed`).toBe(TRANSPORTER);

  // 2. They are genuinely two different values.
  expect(vehicleShown, `${where}: Vehicle No is not the transporter name`).not.toBe(
    transportShown,
  );

  // 3. Neither leaked into the other's field — the old bug, stated directly.
  expect(vehicleShown, `${where}: the transporter name did not leak into Vehicle No`).not.toContain(
    TRANSPORTER,
  );
  expect(
    transportShown,
    `${where}: the vehicle number did not leak into Transport`,
  ).not.toContain(VEHICLE_NO);
}

// Serial: test 3 reads back the challan test 2 creates.
test.describe.serial('Delivery Challan — Vehicle No field', () => {
  /** Set by test 2 so test 3 knows which challan to reopen. */
  let createdDcCode = '';

  test('create form: Vehicle No renders next to Transporter and accepts input', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ── Step 1: the PO picker. Loading it is a read; picking a PO is a
    //    client-side route change to ?poId=<id>. Neither writes anything.
    await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // The route is permission-gated on ospdc_create `entry`. If the e2e login
    // lacks it the form never renders, so fail with a message that says why
    // rather than a mystery "locator not found".
    const denied = await page.getByText(/do not have entry access/i).count();
    expect(
      denied,
      'the E2E login needs entry access on the OSP DC create page (ospdc_create)',
    ).toBe(0);

    // Open the form against OUR PO, not whatever happens to be first in the
    // list — picking is harmless, but it keeps this test on our own data.
    const poCode = ownPoCode();
    await page.locator('#dc-po-search').fill(poCode);
    await page.waitForTimeout(3000);

    const poRow = page.getByRole('row').filter({ hasText: poCode });
    await expect(poRow, `the picker listed ${poCode}`).toHaveCount(1, { timeout: 20_000 });
    await poRow.getByRole('link', { name: /^Select$/ }).click();
    await expect(page, 'picking a PO puts poId in the URL').toHaveURL(/[?&]poId=/, {
      timeout: 20_000,
    });
    await page.waitForTimeout(3500);

    // ── ASSERT 1: the field exists, by id and by its visible label.
    const vehicleById = page.locator('#dc-vehicle-no');
    await expect(vehicleById, 'input #dc-vehicle-no exists on the create form').toBeVisible({
      timeout: 20_000,
    });

    const vehicleByLabel = page.getByLabel(/Vehicle No/i);
    await expect(
      vehicleByLabel,
      'the "Vehicle No" label is wired to the input via htmlFor',
    ).toBeVisible();
    await expect(
      vehicleByLabel,
      'getByLabel("Vehicle No") resolves to exactly one control',
    ).toHaveCount(1);

    // ── ASSERT 2: it starts empty (a new DC has no vehicle yet).
    await expect(vehicleById, 'Vehicle No starts blank').toHaveValue('');

    // ── ASSERT 3: it sits next to Transporter. Playwright returns matches in
    //    DOM order, so Transporter first / Vehicle No second proves adjacency
    //    without depending on any CSS class or grid layout.
    const pair = page.locator('#dc-transport, #dc-vehicle-no');
    await expect(pair, 'both Transporter and Vehicle No are on the form').toHaveCount(2);
    await expect(pair.nth(0), 'Transporter comes first').toHaveAttribute('id', 'dc-transport');
    await expect(pair.nth(1), 'Vehicle No comes immediately after it').toHaveAttribute(
      'id',
      'dc-vehicle-no',
    );

    // Soft: they should share the same field grid. Warns instead of failing if
    // the frontend puts the 4th field in a new row — that is a layout choice,
    // not a break in the feature.
    const sharedGrid = page
      .locator('.form-grid-3')
      .filter({ has: page.locator('#dc-transport') })
      .filter({ has: page.locator('#dc-vehicle-no') });
    await expect
      .soft(sharedGrid, 'Transporter and Vehicle No share one field grid')
      .toHaveCount(1);

    // ── ASSERT 4: typing works. If value/onChange were mis-wired (a stale
    //    controlled input) the text would bounce straight back out.
    await vehicleById.fill(VEHICLE_NO);
    await expect(vehicleById, 'the typed vehicle number sticks in the field').toHaveValue(
      VEHICLE_NO,
    );

    // Transporter must stay independent — the two are separate columns and one
    // must not overwrite the other.
    await expect(
      page.locator('#dc-transport'),
      'typing a vehicle number does not leak into Transporter',
    ).toHaveValue('');

    // ── ASSERT 5 (safety, and a real check): Save is still disabled, because
    //    no send quantity was entered. Nothing on this page can have saved.
    await expect(
      page.getByRole('button', { name: /Save DC/i }),
      'Save DC stays disabled — this test never submits',
    ).toBeDisabled();

    // Leave the page clean. Nothing was persisted; this just drops the draft.
    await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
  });

  /**
   * THE TEST THAT WRITES. Creates one real DC. See the file header.
   */
  test('save round trip: Vehicle No is stored and read back, distinct from Transport', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const poCode = ownPoCode();

    // ── Step 1: open the picker and find that exact PO.
    await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    expect(
      await page.getByText(/do not have entry access/i).count(),
      'the E2E login needs entry access on the OSP DC create page (ospdc_create)',
    ).toBe(0);

    await page.locator('#dc-po-search').fill(poCode);
    await page.waitForTimeout(3000);

    // Fail loudly rather than skip — "nothing to test against" is a real result
    // the user needs to see, not a green run.
    expect(
      await page.getByText(/No Job Work \/ Service PO is open for dispatch/i).count(),
      `PO ${poCode} is not open for dispatch. It must be a Job Work or Service PO ` +
        `whose status is not draft and not cancelled.`,
    ).toBe(0);

    const poRow = page.getByRole('row').filter({ hasText: poCode });
    await expect(poRow, `the picker listed exactly one row for ${poCode}`).toHaveCount(1, {
      timeout: 20_000,
    });
    await poRow.getByRole('link', { name: /^Select$/ }).click();
    await expect(page, 'picking the PO puts poId in the URL').toHaveURL(/[?&]poId=/, {
      timeout: 20_000,
    });

    // ── Step 2: wait for the line drafts to load from the PO.
    const qtyInput = page.locator('.innovic-table input[type="number"]').first();
    await expect(qtyInput, 'the PO lines loaded into "Items to Send"').toBeVisible({
      timeout: 30_000,
    });

    // ── Step 3: read the auto-filled DC number. It is format-locked to
    //    IN-DC-#####, so it cannot carry the E2E_ marker — capture it instead
    //    so the log tells the user exactly which row to clean up.
    const codeInput = page.locator('#dc-code');
    await expect(codeInput, 'the DC number auto-filled').not.toHaveValue('', {
      timeout: 30_000,
    });
    const dcCode = await codeInput.inputValue();
    expect(dcCode, 'the auto-filled DC number matches the IN-DC-##### format').toMatch(
      /^IN-DC-\d{5}$/,
    );
    // The Save button only enables once the async duplicate check has cleared.
    await expect(
      page.getByText('✓ Available'),
      'the DC number passed its duplicate check',
    ).toBeVisible({ timeout: 30_000 });

    // ── Step 4: fill the header. Two clearly different strings — this is the
    //    whole point of the test.
    await page.locator('#dc-transport').fill(TRANSPORTER);
    await page.locator('#dc-vehicle-no').fill(VEHICLE_NO);

    // Catch a crossed wire in the form itself before we ever hit the server.
    await expect(page.locator('#dc-transport'), 'Transporter holds its own text').toHaveValue(
      TRANSPORTER,
    );
    await expect(page.locator('#dc-vehicle-no'), 'Vehicle No holds its own text').toHaveValue(
      VEHICLE_NO,
    );

    // ── Step 5: send exactly one piece on the first line. Markers in the line
    //    text so the row is traceable even though its code cannot be prefixed.
    await qtyInput.fill(SEND_QTY);
    await page.locator('.innovic-table input[placeholder="optional"]').first().fill(MATERIAL_TEXT);
    await page
      .locator('.innovic-table textarea[placeholder="optional"]')
      .first()
      .fill(REMARKS_TEXT);

    const saveButton = page.getByRole('button', { name: /Save DC/i });
    await expect(saveButton, 'Save DC enabled once code and quantity are valid').toBeEnabled({
      timeout: 30_000,
    });

    // eslint-disable-next-line no-console
    console.log(
      `>> CREATING ${dcCode} against ${poCode}: send ${SEND_QTY}, ` +
        `transport "${TRANSPORTER}", vehicle "${VEHICLE_NO}"`,
    );

    // ── Step 6: SAVE. This is the write.
    await saveButton.click();

    // The server can refuse. The likeliest refusal is the ADR-078 availability
    // guard in applyOutwardToJcOp — "Cannot outsource N pcs — only 0 available
    // on this operation" — which fires when the job-card operation behind the
    // PO has no cleared quantity from the step before it. Report whatever the
    // form put on screen instead of a bare navigation timeout.
    try {
      await page.waitForURL(/\/delivery-challans\/[0-9a-f]{8}-/i, { timeout: 90_000 });
    } catch {
      const banner = page
        .locator('div')
        .filter({ hasText: /Cannot outsource|cannot ship|Failed to create DC|validation/i })
        .last();
      const message = (await banner.innerText().catch(() => '')).trim();
      throw new Error(
        'The DC was rejected — nothing was created. ' +
          `Reason shown by the app: ${message || '(no message on screen; check the browser console in the trace)'}`,
      );
    }

    createdDcCode = dcCode;
    rememberDc(dcCode);
    // eslint-disable-next-line no-console
    console.log(
      `>> CREATED ${dcCode} — job card operation behind ${poCode} has been advanced. ` +
        `To undo: open ${dcCode} and press "Cancel DC".`,
    );

    // ── Step 7: the round trip, on the page the app itself navigated to.
    await page.waitForTimeout(3000);

    // ── ASSERT 6: it is the DC we just created, not some other page.
    await expect(
      page.getByText(dcCode, { exact: false }).first(),
      `the detail page is ${dcCode}`,
    ).toBeVisible({ timeout: 20_000 });

    // ── ASSERT 7-9: the feature itself.
    await expectTransportAndVehicleAreSeparate(page, `${dcCode} right after save`);

    // ── ASSERT 10: reload from scratch. Proves the value came out of the
    //    database and not a cached mutation response held in TanStack Query.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await expectTransportAndVehicleAreSeparate(page, `${dcCode} after a full page reload`);
  });

  test('cold load from the register: both values come back from the database, still separate', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Falls back to the recorded challan so this read-only check can be run on
    // its own (-g "cold load") without re-running the test that writes.
    const dcCode = createdDcCode || rememberedDc();
    expect(
      dcCode,
      'a DC exists to reopen — run the save round-trip test first, or check ' +
        `${ARTIFACT}`,
    ).toMatch(/^IN-DC-\d{5}$/);
    createdDcCode = dcCode;

    // Reach the challan the way a user would — from the register, in a fresh
    // page load, with no state carried over from the create form. Any value
    // shown here has been fetched from the server.
    await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const noDcs = await page.getByText(/No OSP DCs yet/i).count();
    expect(noDcs, 'the DC register is no longer empty').toBe(0);

    const dcLink = page.getByRole('link', { name: createdDcCode }).first();
    await expect(dcLink, `the register lists ${createdDcCode}`).toBeVisible({ timeout: 30_000 });
    await dcLink.click();
    await expect(page, 'opened the DC detail page').toHaveURL(
      /\/delivery-challans\/[0-9a-f]{8}-/i,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(3000);

    // ── ASSERT 11: Vehicle No is its own labelled field, separate from
    //    Transport — one of each, not one field doing both jobs.
    await expect(
      page.getByText('Vehicle No', { exact: true }),
      'the DC detail shows exactly one Vehicle No field',
    ).toHaveCount(1);
    await expect(
      page.getByText('Transport', { exact: true }),
      'the DC detail shows exactly one Transport field, separately',
    ).toHaveCount(1);

    // ── ASSERT 12-14: the feature, from a cold load.
    await expectTransportAndVehicleAreSeparate(page, `${createdDcCode} on a cold load`);
  });

  /**
   * THE ORIGINAL BUG, CHECKED WHERE IT ACTUALLY BIT: the printed challan.
   *
   * Before this feature, print-ospdc.ts read the transporter box into a
   * variable named `vehicleNo`, so the printed OSP DC displayed a transporter's
   * NAME in the vehicle position. That is what the shop floor and the vendor
   * saw, and it is the thing worth proving.
   *
   * This is checkable because openDocPrintWindow (apps/web/src/lib/print/
   * doc-print.ts) builds the document with window.open('') + document.write —
   * so Playwright can capture the popup and read the real print markup. It
   * never calls w.print(), so no native dialog blocks the run.
   *
   * Read-only: printing writes nothing.
   */
  test('printed challan: Transport and Vehicle No. print as two separate labelled fields', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const dcCode = createdDcCode || rememberedDc();
    expect(
      dcCode,
      'a DC exists to print — run the save round-trip test first, or check ' +
        `${ARTIFACT}`,
    ).toMatch(/^IN-DC-\d{5}$/);
    createdDcCode = dcCode;

    await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    await page.getByRole('link', { name: createdDcCode }).first().click();
    await expect(page, 'opened the DC detail page').toHaveURL(
      /\/delivery-challans\/[0-9a-f]{8}-/i,
      { timeout: 20_000 },
    );
    // The print needs the company and template queries to have resolved.
    await page.waitForTimeout(5000);

    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 60_000 }),
      page.getByRole('button', { name: /Print/i }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');

    // Meta cells render as:
    //   <div><span class="meta-lbl">Transport:</span> <b>VALUE</b></div>
    const readPrintMeta = async (label: string): Promise<string> => {
      const row = popup.locator(`div:has(> span.meta-lbl:text-is("${label}:"))`).first();
      await expect(row, `the printed challan has a "${label}" field`).toBeVisible({
        timeout: 30_000,
      });
      return (await row.locator('b').first().innerText()).trim();
    };

    const printedTransport = await readPrintMeta('Transport');
    const printedVehicle = await readPrintMeta('Vehicle No.');
    // eslint-disable-next-line no-console
    console.log(
      `>> printed ${createdDcCode} — Transport: "${printedTransport}" | ` +
        `Vehicle No.: "${printedVehicle}"`,
    );

    // ── ASSERT 15: each prints its own value...
    expect(printedTransport, 'the printed Transport field shows the transporter').toBe(
      TRANSPORTER,
    );
    expect(printedVehicle, 'the printed Vehicle No. field shows the vehicle number').toBe(
      VEHICLE_NO,
    );

    // ── ASSERT 16: ...and specifically, the vehicle position no longer shows
    //    the transporter's name. This is the regression that started it all.
    expect(
      printedVehicle,
      'the printed Vehicle No. is NOT the transporter name (the original bug)',
    ).not.toBe(printedTransport);
    expect(
      printedVehicle,
      'the transporter name does not appear in the printed Vehicle No.',
    ).not.toContain(TRANSPORTER);

    await popup.close();
  });
});

/**
 * CLEANING UP
 *
 * In the app FIRST — it is the only thing that reverses the cascade:
 *   Open the new IN-DC-##### and press "Cancel DC". That runs
 *   reverseOutwardFromJcOp: outsource_sent_qty goes back down, outsource_dc_no
 *   is cleared, and outsource_status drops from 'sent' back to 'po_created'.
 *   Requires edit + approve permission on ospdc_create.
 *
 * Then, if the cancelled challan should not stay in the register:
 *   UPDATE public.delivery_challan_lines SET deleted_at = now()
 *     WHERE delivery_challan_id IN
 *       (SELECT id FROM public.delivery_challans WHERE vehicle_no = 'E2E_MH12AB1234');
 *   UPDATE public.delivery_challans SET deleted_at = now()
 *     WHERE vehicle_no = 'E2E_MH12AB1234';
 *
 * Do NOT soft-delete the DC without cancelling it first — deleting the row does
 * not run reverseOutwardFromJcOp, so the job card would stay marked as "sent"
 * against a challan that no longer exists.
 *
 * The rest of the chain (SO / JC / PR / PO) is undone separately — see the
 * report from flow-dc-vehicle-chain.spec.ts.
 *
 * Activity-log rows (DC_ISSUE, OP_OUTSOURCE_SENT) are audit history and stay.
 */
