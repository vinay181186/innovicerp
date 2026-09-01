import { expect, test, type Page } from '@playwright/test';

/**
 * Vehicle No on the Delivery Challan.
 *
 * Contract (packages/shared/src/schemas/delivery-challan.ts):
 *   deliveryChallanSchema.vehicleNo                      : string | null
 *   createDeliveryChallanInputSchema.header.vehicleNo    : string | null | undefined
 *
 * Column verified live in production: public.delivery_challans.vehicle_no (text, nullable).
 *
 * ─── HOW TO RUN THIS FILE ──────────────────────────────────────────────────
 * NOT under the default playwright.config.ts. That config drives
 * http://localhost:5173, and the production API does not allow that origin —
 * a preflight to the Railway API returns NO `access-control-allow-origin` for
 * http://localhost:5173, but does return one for https://innovic-erp.pages.dev.
 * Every API call from localhost therefore dies as "Couldn't reach the server".
 *
 * So this file has to run against the deployed Pages build, i.e. under
 * playwright.pages.config.ts. That config's chromium project only picks up
 * files matching /flow-.*\.spec\.ts/, so the file must be named
 * flow-dc-vehicle-no.spec.ts before it will run at all.
 *
 * ─── TEST 3 WRITES TO PRODUCTION ───────────────────────────────────────────
 * Tests 1 and 2 only read. Test 3 creates one real Delivery Challan and, via
 * apps/api/src/modules/delivery-challans/cascades.ts (applyOutwardToJcOp),
 * permanently moves a real job-card operation forward:
 *     outsource_sent_qty += qty
 *     outsource_dc_no    = <the new DC code>
 *     outsource_status   → 'sent'
 * The user has approved this. It is undone by pressing "Cancel DC" on the new
 * challan in the app, which runs reverseOutwardFromJcOp and puts the operation
 * back. A raw SQL delete of the DC row does NOT undo it.
 *
 * Because it consumes a real purchase order's material, test 3 refuses to pick
 * a PO on its own. You must name the one you are willing to consume:
 *     E2E_DC_PO_CODE=IN-PO-00001      (in apps/web/.env.e2e, or the shell)
 *
 * Naming note: the DC code itself cannot carry the E2E_ marker — the document
 * number format is locked to ^IN-DC-\d{5}$ (packages/shared/src/schemas/
 * doc-number.ts). The E2E_ marker goes into Transporter, Vehicle No, Material
 * and Remarks instead, so the row is still findable.
 */

// Typed into Vehicle No. Deliberately unlike the transporter name below — the
// bug this feature fixes is the two values getting crossed.
const VEHICLE_NO = 'E2E_MH12AB1234';
// Typed into Transporter. Shares no substring with VEHICLE_NO.
const TRANSPORTER = 'E2E_ROADWAYS_PVT_LTD';
const MATERIAL_TEXT = 'E2E_MATERIAL';
const REMARKS_TEXT = 'E2E_VEHICLE_NO_ROUNDTRIP';
// Smallest possible send. Keeps the permanent job-card cascade to 1 piece.
const SEND_QTY = '1';

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

test.describe('Delivery Challan — Vehicle No field', () => {
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

    const emptyPicker = await page
      .getByText(/No Job Work \/ Service PO is open for dispatch/i)
      .count();
    test.skip(
      emptyPicker > 0,
      'No eligible Job Work / Service PO exists to open the create form against.',
    );

    // First row of the PO picker. "Select" is a <Link>, not a save.
    const selectLink = page.getByRole('link', { name: /^Select$/ }).first();
    await expect(selectLink, 'PO picker listed at least one eligible PO').toBeVisible({
      timeout: 20_000,
    });
    await selectLink.click();
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

  test('detail page: Vehicle No is displayed as its own field', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/delivery-challans', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const noDcs = await page.getByText(/No OSP DCs yet/i).count();
    test.skip(noDcs > 0, 'No delivery challans exist to open.');

    // Open the first DC by its code link. Read-only navigation.
    const dcLink = page.getByRole('link', { name: /IN-DC-\d+/ }).first();
    await expect(dcLink, 'the DC register listed at least one challan').toBeVisible({
      timeout: 20_000,
    });
    const dcCode = (await dcLink.innerText()).trim();
    await dcLink.click();
    await expect(page, 'opened a DC detail page').toHaveURL(
      /\/delivery-challans\/[0-9a-f]{8}-/i,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(3000);
    // eslint-disable-next-line no-console
    console.log(`>> reading DC ${dcCode}`);

    // ── ASSERT 6: "Vehicle No" appears as its own labelled field, separate
    //    from Transport. Challans raised before this column shipped show the
    //    em-dash placeholder — that still proves it renders.
    const vehicleLabel = page.getByText('Vehicle No', { exact: true });
    await expect(vehicleLabel, 'the DC detail shows a Vehicle No field').toBeVisible({
      timeout: 20_000,
    });
    await expect(vehicleLabel, 'exactly one Vehicle No field').toHaveCount(1);

    await expect(
      page.getByText('Transport', { exact: true }),
      'Transport is still shown, separately',
    ).toBeVisible();

    const shown = await readPair(page, 'Vehicle No');
    // eslint-disable-next-line no-console
    console.log(`>> Vehicle No on ${dcCode}: "${shown}"`);
    expect(
      shown.length,
      'the Vehicle No field renders a value or the — placeholder',
    ).toBeGreaterThan(0);
  });

  /**
   * THE ONE TEST THAT WRITES. Creates a real DC. See the file header.
   */
  test('save round trip: Vehicle No is stored and read back, distinct from Transport', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // ── Guard 0: the caller must name the PO they are willing to consume.
    //    Without this the test would grab whatever PO happened to be first in
    //    the list and permanently send a piece of its material to a vendor.
    const poCode = process.env.E2E_DC_PO_CODE?.trim();
    expect(
      poCode,
      'Set E2E_DC_PO_CODE to the Job Work / Service PO you are willing to consume, ' +
        'e.g. E2E_DC_PO_CODE=IN-PO-00001 in apps/web/.env.e2e. This test permanently ' +
        'sends material against that PO, so it will not choose one for you.',
    ).toBeTruthy();

    // ── Step 1: open the picker and find that exact PO.
    await page.goto('/delivery-challans/new', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    expect(
      await page.getByText(/do not have entry access/i).count(),
      'the E2E login needs entry access on the OSP DC create page (ospdc_create)',
    ).toBe(0);

    await page.locator('#dc-po-search').fill(poCode!);
    await page.waitForTimeout(3000);

    // Fail loudly rather than skip — "nothing to test against" is a real result
    // the user needs to see, not a green run.
    expect(
      await page.getByText(/No Job Work \/ Service PO is open for dispatch/i).count(),
      `PO ${poCode} is not open for dispatch. It must be a Job Work or Service PO ` +
        `whose status is not draft and not cancelled.`,
    ).toBe(0);

    const poRow = page.getByRole('row').filter({ hasText: poCode! });
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
      // Still on the form → the save failed. The form re-enables Save and shows
      // the reason in a red banner just above it.
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

    // eslint-disable-next-line no-console
    console.log(
      `>> CREATED ${dcCode} — job card operation behind ${poCode} has been advanced. ` +
        `To undo: open ${dcCode} and press "Cancel DC".`,
    );

    // ── Step 7: the round trip. We are now on the detail page the app itself
    //    navigated to, showing data re-fetched from the database.
    await page.waitForTimeout(3000);

    const vehicleShown = await readPair(page, 'Vehicle No');
    const transportShown = await readPair(page, 'Transport');
    // eslint-disable-next-line no-console
    console.log(`>> read back — Transport: "${transportShown}" | Vehicle No: "${vehicleShown}"`);

    // ── ASSERT 7: the vehicle number came back byte-for-byte.
    expect(vehicleShown, 'Vehicle No survived the round trip exactly as typed').toBe(VEHICLE_NO);

    // ── ASSERT 8: the transporter came back too, and separately.
    expect(transportShown, 'Transport survived the round trip exactly as typed').toBe(TRANSPORTER);

    // ── ASSERT 9: THE POINT OF THIS FEATURE. The two are distinct values and
    //    neither has been written into the other's column.
    expect(vehicleShown, 'Vehicle No is not the transporter name').not.toBe(transportShown);
    expect(vehicleShown, 'the transporter name did not leak into Vehicle No').not.toContain(
      TRANSPORTER,
    );
    expect(transportShown, 'the vehicle number did not leak into Transport').not.toContain(
      VEHICLE_NO,
    );

    // ── ASSERT 10: it is the DC we just created, not some other page.
    await expect(
      page.getByText(dcCode, { exact: false }).first(),
      `the detail page is ${dcCode}`,
    ).toBeVisible({ timeout: 20_000 });

    // ── ASSERT 11: reload from scratch. Proves the value came out of the
    //    database and not a cached mutation response held in TanStack Query.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    expect(
      await readPair(page, 'Vehicle No'),
      'Vehicle No is still correct after a full page reload',
    ).toBe(VEHICLE_NO);
    expect(
      await readPair(page, 'Transport'),
      'Transport is still correct after a full page reload',
    ).toBe(TRANSPORTER);
  });
});

/**
 * CLEANING UP AFTER TEST 3
 *
 * In the app (do this first — it is the only thing that reverses the cascade):
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
 * Activity-log rows (DC_ISSUE, OP_OUTSOURCE_SENT) are audit history and are
 * meant to stay.
 */
