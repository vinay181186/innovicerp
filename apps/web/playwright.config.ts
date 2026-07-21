import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright e2e configuration for the Innovic ERP web app.
 *
 * Per CLAUDE.md Section 9, e2e coverage is intentionally limited to the
 * critical user flows (login, create a Job Card, log an Operation,
 * generate a Sales Order) — NOT broad UI coverage.
 *
 * The dev server (Vite, port 5173) is started automatically unless one is
 * already running.
 */
const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
