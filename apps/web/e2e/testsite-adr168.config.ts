// TEST STACK ONLY — https://innovic-erp.pages.dev (its own database; production
// is never touched). Runs e2e/testsite-adr168.spec.ts with the saved session in
// .playwright/testsite-auth.json (gitignored). No setup project.
//
//   cd apps/web && npx playwright test -c e2e/testsite-adr168.config.ts
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
    {
      name: 'chromium',
      testMatch: /testsite-adr168\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: '.playwright/testsite-auth.json' },
    },
  ],
});
