import { expect, test } from '@playwright/test';

// A dropdown must always touch the field it belongs to, whichever way it opens.
//
// The upward case used to be positioned as "input top minus the full height the
// list MAY use", which only lands correctly when the list fills that height. A
// short list (one row, or "No matches") was left floating ~250px above its own
// field, next to some unrelated control — and because the gap depended on the
// number of options, it appeared somewhere different every time.
//
// Also pins one id per row: every picker on the dispatch page used to render
// id="searchable-select", so two rows meant two elements sharing one id.
//
// Read-only: opens the dispatch form and never saves.
//
// Run: npx playwright test --config=playwright.pages.config.ts -g "@anchor"

const SO_MATCH = /IN-SO-00011/;

test('@anchor the list stays attached to its field, and each row has its own id', async ({
  page,
}) => {
  // A short viewport forces the lower rows to open upward — the broken case.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/customer-dispatches/new');

  const soSel = page.locator('select').first();
  await expect(soSel).toBeVisible({ timeout: 30_000 });
  // The SO list arrives from the API — wait for it, or the options are just the
  // "-- Select SO --" placeholder and the test skips itself for no reason.
  await expect
    .poll(async () => soSel.locator('option').count(), { timeout: 30_000 })
    .toBeGreaterThan(1);
  const labels = await soSel.locator('option').allTextContents();
  const target = labels.find((t) => SO_MATCH.test(t));
  test.skip(!target, 'IN-SO-00011 not in the SO list');
  await soSel.selectOption({ label: target! });

  const addLine = page.getByRole('button', { name: /Add Line/i });
  await addLine.click();
  // The dispatchable lines arrive from the API. Measure only once a row really
  // has options, otherwise every list is the one-row "No ready items" box and
  // the populated case goes unchecked.
  const firstBox = page.locator('input[role="combobox"]').first();
  await expect
    .poll(
      async () => {
        await firstBox.click();
        const n = await page.locator('[role="listbox"] [role="option"]').count();
        await page.keyboard.press('Escape');
        return n;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  await addLine.click();

  // --- one id per row ------------------------------------------------------
  const ids = await page
    .locator('input[role="combobox"]')
    .evaluateAll((els) => els.map((e) => e.id));
  // eslint-disable-next-line no-console
  console.log(`>> combobox ids: ${JSON.stringify(ids)}`);
  expect(ids.length).toBeGreaterThan(1);
  expect(new Set(ids).size, 'duplicate DOM ids on the page').toBe(ids.length);

  // --- the list touches its field, both directions -------------------------
  for (const [i, id] of ids.entries()) {
    const input = page.locator(`#${id}`);
    await input.click();
    const list = page.locator(`#${id}-listbox`);
    await expect(list).toBeVisible({ timeout: 15_000 });

    const ib = (await input.boundingBox())!;
    const lb = (await list.boundingBox())!;
    const opts = await list.locator('[role="option"]').count();

    // Gap between the two, whichever side the list took.
    const gap = lb.y >= ib.y ? lb.y - (ib.y + ib.height) : ib.y - (lb.y + lb.height);
    const side = lb.y >= ib.y ? 'below' : 'above';
    // eslint-disable-next-line no-console
    console.log(`>> row ${i + 1}: opens ${side}, ${opts} option(s), gap ${Math.round(gap)}px`);

    expect(gap, `row ${i + 1} list is detached from its field`).toBeLessThanOrEqual(12);
    expect(gap, `row ${i + 1} list overlaps its field`).toBeGreaterThanOrEqual(-1);
    // Left edges align — it is anchored to THIS field, not some other one.
    expect(Math.abs(lb.x - ib.x)).toBeLessThanOrEqual(2);

    await page.keyboard.press('Escape');
  }
});
