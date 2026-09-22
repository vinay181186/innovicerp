// Playwright config for the TEST stack ONLY (https://innovic-erp.pages.dev with
// the innovic.technology test login). Kept inside e2e/ and separate from
// playwright.pages.config.ts so a run here can never pick up the production
// credentials in .env.e2e.
//
// Credentials come from the shell: TESTSITE_EMAIL / TESTSITE_PASSWORD.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 1_800_000,
  use: {
    baseURL: 'https://innovic-erp.pages.dev',
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  projects: [
    { name: 'setup', testMatch: /testsite-auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /testsite-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: '.playwright/testsite-auth.json' },
      dependencies: ['setup'],
    },
  ],
});
