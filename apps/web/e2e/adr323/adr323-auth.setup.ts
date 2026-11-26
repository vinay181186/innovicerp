import { expect, test as setup } from '@playwright/test';
setup('authenticate', async ({ page }) => {
  setup.setTimeout(90_000);
  const email = process.env.E2E_EMAIL!;
  const password = process.env.E2E_PASSWORD!;
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(email, { timeout: 30_000 });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.evaluate(() => localStorage.setItem('innovic-erp-e2e-keep-login', '1'));
  await page.context().storageState({ path: 'e2e/adr323/.auth.json' });
});
