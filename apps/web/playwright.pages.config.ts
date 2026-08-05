import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/constants';

// Run the e2e flow against the DEPLOYED Cloudflare Pages frontend (CORS-allowed
// by the prod API; the custom domain erp.innovic.in does not resolve from every
// network, and localhost:5173 is CORS-blocked by the prod API). Credentials come
// from apps/web/.env.e2e (E2E_EMAIL / E2E_PASSWORD).
try {
  process.loadEnvFile(new URL('.env.e2e', import.meta.url));
} catch {
  // creds may come from the shell env instead
}

const BASE_URL = 'https://innovic-erp.pages.dev';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 600_000,

  use: {
    baseURL: BASE_URL,
    trace: 'on',
    screenshot: 'on',
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /flow-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
