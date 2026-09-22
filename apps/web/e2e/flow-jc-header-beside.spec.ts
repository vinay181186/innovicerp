// Read-only check: on the JC detail header the item code · name · Material ·
// Size sit BESIDE the 120 px picture (user decision 2026-09-21), not under it.
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = '.playwright/reports';
const JC = 'IN-JC-26-00002';

async function openJcDetail(page: Page, code: string): Promise<void> {
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/Search JC no\./);
  await search.waitFor({ timeout: 45_000 });
  await search.fill(code);
  const link = page.locator('a[href*="/job-cards/"]').filter({ hasText: code }).first();
  await link.waitFor({ timeout: 45_000 });
  await link.click();
  await expect(page).toHaveURL(/\/job-cards\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await page.getByText('Route / Operation Flow').waitFor({ timeout: 45_000 });
  await page.locator('div[style*="height: 92px"]').first().waitFor({ timeout: 45_000 });
  await page.waitForTimeout(1200);
}

test('JC header: text block sits beside the picture', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await openJcDetail(page, JC);
  const header = page.locator('.panel').filter({ hasText: 'Order Qty' }).first();
  const img = header.locator('img').first();
  await img.waitFor({ timeout: 30_000 });
  const imgBox = (await img.boundingBox())!;
  const code = header.getByText('554117187000/r0');
  const material = header.getByText('Material:');
  const size = header.getByText('Size:');
  const codeBox = (await code.boundingBox())!;
  const matBox = (await material.boundingBox())!;
  const sizeBox = (await size.boundingBox())!;
  // eslint-disable-next-line no-console
  console.log('img', imgBox, 'code', codeBox, 'material', matBox, 'size', sizeBox);
  // The picture box is 120 wide (image inside has 8 px padding → ≥104 visible).
  expect(imgBox.width).toBeGreaterThanOrEqual(100);
  // Beside: text starts to the RIGHT of the picture, and all of it starts
  // within the picture's vertical band (not below it).
  for (const b of [codeBox, matBox, sizeBox]) {
    expect(b.x).toBeGreaterThan(imgBox.x + imgBox.width - 1);
    expect(b.y).toBeGreaterThanOrEqual(imgBox.y - 8);
    expect(b.y).toBeLessThan(imgBox.y + imgBox.height);
  }
  // Order top-down: code, then Material, then Size.
  expect(matBox.y).toBeGreaterThan(codeBox.y);
  expect(sizeBox.y).toBeGreaterThan(matBox.y);
  await page.screenshot({ path: `${OUT}/jc-header-beside-2026-09-21.png`, fullPage: false });
});
