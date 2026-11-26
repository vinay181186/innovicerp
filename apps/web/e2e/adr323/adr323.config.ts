import { defineConfig, devices } from '@playwright/test';
// ADR-323 verification — TEST site only. Creds from the working jinal login file.
try {
  process.loadEnvFile('C:/Innovic_projects/innovic-erp/wt-dcscreens/apps/web/.env.e2e');
} catch {
  /* shell env */
}
export const ADR323_STATE = 'e2e/adr323/.auth.json';
export default defineConfig({
  testDir: '.',
  outputDir: './results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 300_000,
  use: { baseURL: 'https://innovic-erp.pages.dev', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'setup', testMatch: /adr323-auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /flow-adr323.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: 'e2e/adr323/.auth.json' },
      dependencies: ['setup'],
    },
  ],
});
