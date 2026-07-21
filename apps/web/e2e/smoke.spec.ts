import { test, expect } from '@playwright/test';

/**
 * Smoke test — verifies the app boots and serves a page.
 * This is the setup verification test; real critical-flow specs
 * (login, Job Card, Op log, Sales Order) go in their own files.
 */
test('app loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('#root')).toBeAttached();
});
