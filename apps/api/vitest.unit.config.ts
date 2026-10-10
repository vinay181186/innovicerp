import { defineConfig } from 'vitest/config';

// Database-free unit tests (`*.unit.test.ts`, ADR-229). No globalSetup: the main config's setup
// connects to a database and sweeps test rows, which these files never need.
// Run with `pnpm --filter @innovic/api test:unit` — no .env file is read.
export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts'],
  },
});
