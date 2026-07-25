import { expect, test as setup } from '@playwright/test';
import { STORAGE_STATE } from './constants';

/**
 * Auth setup project — logs in ONCE via the real login UI and saves the
 * resulting Supabase session (localStorage) to a storageState file that every
 * other e2e project reuses. This avoids logging in per-test.
 *
 * Credentials come from the environment (never hardcoded, never committed):
 *   E2E_EMAIL / E2E_PASSWORD
 * Put them in apps/web/.env.e2e (gitignored) or export them in your shell.
 *
 * NOTE: the dev server points at the LIVE Supabase (see apps/web/.env.local),
 * so use a low-privilege real account. Our specs are read-only.
 */
setup('authenticate', async ({ page }) => {
  setup.setTimeout(90_000); // live prod app + first login round-trip
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Missing E2E_EMAIL / E2E_PASSWORD. Create apps/web/.env.e2e with:\n' +
        '  E2E_EMAIL=you@company.com\n' +
        '  E2E_PASSWORD=your-password\n' +
        '(gitignored) then re-run. These log the browser into the real app.',
    );
  }

  // 'load' can stall on the live app (open realtime sockets, long polls);
  // domcontentloaded + explicit element waits is the reliable pattern.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Login defaults to password mode (login.tsx: useState<Mode>('password')).
  await page.getByLabel('Email').fill(email, { timeout: 30_000 });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // On success the app navigates to '/' (replace). Wait until we're off /login.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });

  await page.context().storageState({ path: STORAGE_STATE });
});
