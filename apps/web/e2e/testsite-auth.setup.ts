import { expect, test as setup } from '@playwright/test';

const STATE = '.playwright/testsite-auth.json';

setup('authenticate on the test stack', async ({ page }) => {
  setup.setTimeout(180_000);
  const email = process.env.TESTSITE_EMAIL;
  const password = process.env.TESTSITE_PASSWORD;
  if (!email || !password) throw new Error('Set TESTSITE_EMAIL / TESTSITE_PASSWORD in the shell.');

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(email, { timeout: 60_000 });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.context().storageState({ path: STATE });
});
