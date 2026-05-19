import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Manual vendor-chunk splits to keep the main bundle under Vite's 500 KB
// warning threshold. Heavy deps (TanStack Router/Query/Table, lucide icons,
// Supabase client) get their own chunks so users on slow connections only
// re-download what changed. Order matters in the if/else chain — first
// match wins, so most-specific paths come first.
function splitVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('@tanstack/')) return 'vendor-tanstack';
  if (id.includes('lucide-react')) return 'vendor-icons';
  if (id.includes('@sentry/')) return 'vendor-sentry';
  if (id.includes('@supabase/')) return 'vendor-supabase';
  if (id.includes('react-hook-form') || id.includes('@hookform/') || id.includes('/zod/')) {
    return 'vendor-forms';
  }
  if (id.includes('date-fns')) return 'vendor-dates';
  // xlsx is huge (~400 KB raw / 150 KB gzip) — pulled in only by BOM form
  // Excel import. Splitting it out lets every other page cache without
  // re-downloading it on app updates.
  if (id.includes('/xlsx/') || id.includes('/cfb/') || id.includes('/codepage/')) {
    return 'vendor-xlsx';
  }
  if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
    return 'vendor-react';
  }
  return undefined; // small utilities (clsx, cva, tw-merge, zustand…) stay in the main bundle
}

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@innovic/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: {
    // Bumped from the default 500 to silence the warning for the main app
    // chunk (~780 KB minified, ~100 KB gzip). At this size the user-facing
    // download is fine on broadband; the chunking work above is the real
    // benefit (vendor chunks re-cache independently of app deploys).
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: splitVendorChunk,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
});
