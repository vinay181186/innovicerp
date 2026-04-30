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
  },
});
