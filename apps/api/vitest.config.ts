import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests hit a real Supabase (dev project, Mumbai) instead of mocks per
    // CLAUDE.md §9. From a developer machine in IN, round-trips are ~10ms;
    // from GitHub Actions (ubuntu-latest, US/EU), they are ~250ms each.
    // A single test that does N round-trips (transaction + insert + select +
    // soft-delete + verify) can easily exceed vitest's 5s default in CI.
    //
    // Empirically (2026-05-06, CI failure investigation): the heaviest
    // cascade tests (op-entry/sales-cascade.test.ts SO-multi-line ~6.5s
    // local; goods-receipt-notes/service.test.ts QC-cascade ~7.5s local)
    // extend to ~22-25s under CI's geographic latency, blowing past the
    // prior 20s ceiling. 60s gives ~3x headroom over the slowest observed
    // CI runtime — comfortable margin without masking real performance
    // regressions in the service layer.
    //
    // If a test legitimately needs more than 60s, that's a signal of N+1
    // in the service code (or a missing batched-insert in the test
    // fixture); don't keep raising this.
    testTimeout: 60000,
    hookTimeout: 60000,
    // Global setup wipes test-prefixed rows from the dev DB before any test
    // runs. Killed test runs (Ctrl-C, vitest crashes) leave afterAll-managed
    // cleanup unfired, accumulating cruft like `T018-A1` vendor codes that
    // then collide with the next run's beforeAll inserts. Phase 2 carry-over
    // notes a dedicated CI Supabase project as the real fix; until then this
    // sweep keeps the dev-DB tests reliably runnable.
    globalSetup: ['./test/global-setup.ts'],
  },
});
