import { expect, test } from '@playwright/test';

/**
 * Vehicle No on the Delivery Challan — READ-ONLY regression cover.
 *
 * Contract (packages/shared/src/schemas/delivery-challan.ts):
 *   deliveryChallanSchema.vehicleNo                      : string | null
 *   createDeliveryChallanInputSchema.header.vehicleNo    : string | null | undefined
 *
 * WHY THIS SPEC WRITES NOTHING
 * ----------------------------
 * The e2e run points at the LIVE Supabase / prod API (apps/web/.env.local).
 * A Delivery Challan cannot be created standalone: /delivery-challans/new
 * requires an existing, already-issued Job Work / Service PO, and saving one
 * fires applyOutwardToJcOp (apps/api/src/modules/delivery-challans/cascades.ts)
 * which mutates a REAL job-card operation —
 *     outsource_sent_qty += qty
 *     outsource_dc_no    = <this DC's code>
 *     outsource_status   → 'sent'
 * — i.e. it consumes a real PO's material and moves someone else's work order
 * forward. That is out of bounds for a test, so this spec only READS.
 *
 * It therefore proves the field EXISTS, is LABELLED, sits NEXT TO Transporter,
 * ACCEPTS typed text, and is RENDERED on the DC detail page. It does NOT prove
 * the value survives a round trip through the database — see the notes at the
 * bottom of this file for what a save-path test would cost.
 *
 * Named without the `flow-` prefix on purpose: playwright.config.ts ignores
 * flow-*.spec.ts because those write to prod. This one is safe to run under the
 * default local config against the dev server.
 *
 * Run: npx playwright test e2e/dc-vehicle-no.spec.ts
 */

// Typed into the field but never saved. Prefixed E2E_ per project convention
// (E2E_SO / E2E_JC / E2E_BOM) in case a future run ever does persist it.
const SAMPLE_VEHICLE_NO = 'E2E_MH12AB1234';

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
    await vehicleById.fill(SAMPLE_VEHICLE_NO);
    await expect(vehicleById, 'the typed vehicle number sticks in the field').toHaveValue(
      SAMPLE_VEHICLE_NO,
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
      'Save DC stays disabled — this spec never submits',
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
    //    from Transport. Existing challans predate the column, so the value is
    //    the em-dash placeholder — that still proves it renders.
    const vehicleLabel = page.getByText('Vehicle No', { exact: true });
    await expect(vehicleLabel, 'the DC detail shows a Vehicle No field').toBeVisible({
      timeout: 20_000,
    });
    await expect(vehicleLabel, 'exactly one Vehicle No field').toHaveCount(1);

    await expect(
      page.getByText('Transport', { exact: true }),
      'Transport is still shown, separately',
    ).toBeVisible();

    // The value sits in the sibling <div> of the label inside .form-grp.
    const vehicleValue = page
      .locator('.form-grp')
      .filter({ has: page.getByText('Vehicle No', { exact: true }) })
      .locator('div')
      .first();
    const shown = (await vehicleValue.innerText()).trim();
    // eslint-disable-next-line no-console
    console.log(`>> Vehicle No on ${dcCode}: "${shown}"`);
    expect(shown.length, 'the Vehicle No field renders a value or the — placeholder').toBeGreaterThan(
      0,
    );
  });
});

/**
 * NOT COVERED — the save round trip.
 *
 * Proving "type it, save it, read it back" needs a real DC to be created, which
 * needs a real issued Job Work / Service PO and permanently advances that PO's
 * job-card operation to outsource_status = 'sent'. There is no test database to
 * do it in. Two honest options if the round trip must be proven:
 *
 *   1. A unit / integration test on the API side (apps/api/.../service.test.ts)
 *      asserting vehicle_no is written and read back. No production rows.
 *   2. A one-off manual check by the user: raise one throwaway DC against a PO
 *      they are willing to consume, with Vehicle No = E2E_MH12AB1234, then look
 *      at the detail page and the OSP DC print.
 *
 * Do not add a save path to this file without a decision on which real PO gets
 * consumed.
 */
