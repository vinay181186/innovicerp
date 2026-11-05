import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/constants';

// CLAUDE.md §23 — the page-open check. Always TEST: the address is fixed here on
// purpose so this can never be pointed at PRODUCTION. E2E_EMAIL / E2E_PASSWORD come
// from the shell (the release script passes the TEST login).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 8,
  retries: 1, // a network blip on one page must not stop a release
  reporter: 'line',
  timeout: 60_000,
  use: { baseURL: 'https://innovic-erp.pages.dev' },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'page-open',
      testMatch: /page-open\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
