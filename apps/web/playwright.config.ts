import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE } from './e2e/constants';

// Load e2e credentials (E2E_EMAIL / E2E_PASSWORD) from a gitignored file if
// present. process.loadEnvFile is built into Node 24 — no dependency needed.
try {
  process.loadEnvFile(new URL('.env.e2e', import.meta.url));
} catch {
  // No .env.e2e — creds may still come from the shell env. auth.setup.ts
  // throws a clear message if they end up missing.
}

// The web app validates VITE_* at boot. vite.config.ts sets envDir to the repo
// root, whose .env.local lacks these — the real values live in apps/web/.env.local.
// Load them here so we can forward them to the dev server webServer spawns below.
try {
  process.loadEnvFile(new URL('.env.local', import.meta.url));
} catch {
  // No apps/web/.env.local — the webServer will fail loudly if VITE_* are unset.
}

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
    // Credential-free boot check — runs without logging in.
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Logs in once and writes the session to STORAGE_STATE.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // Authenticated tests reuse that session.
    {
      name: 'chromium',
      // flow-*.spec.ts are the end-to-end chain runs. They WRITE TO PRODUCTION
      // and are built for playwright.pages.config.ts, which drives the deployed
      // Pages build (the prod API blocks localhost by CORS). This project runs
      // everything it is not told to ignore, so without the second pattern a
      // plain `playwright test` would fire real documents into prod.
      testIgnore: [/smoke\.spec\.ts/, /flow-.*\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Forward the app's runtime config (loaded from apps/web/.env.local above)
    // so Vite exposes valid VITE_* and the app boots instead of crashing.
    env: {
      VITE_API_URL: process.env.VITE_API_URL ?? '',
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? '',
      VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
    },
  },
});
