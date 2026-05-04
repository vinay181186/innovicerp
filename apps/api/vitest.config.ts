import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests hit a real Supabase (dev project, Mumbai) instead of mocks per
    // CLAUDE.md §9. From a developer machine in IN, round-trips are ~10ms;
    // from GitHub Actions (ubuntu-latest, US/EU), they are ~250ms each.
    // A single test that does N round-trips (transaction + insert + select +
    // soft-delete + verify) can easily exceed vitest's 5s default in CI.
    // 20s gives headroom; if a test legitimately needs longer, that's a
    // signal of N+1 in the service code, not a reason to keep raising this.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Global setup wipes test-prefixed rows from the dev DB before any test
    // runs. Killed test runs (Ctrl-C, vitest crashes) leave afterAll-managed
    // cleanup unfired, accumulating cruft like `T018-A1` vendor codes that
    // then collide with the next run's beforeAll inserts. Phase 2 carry-over
    // notes a dedicated CI Supabase project as the real fix; until then this
    // sweep keeps the dev-DB tests reliably runnable.
    globalSetup: ['./test/global-setup.ts'],
  },
});
