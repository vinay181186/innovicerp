import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema';

// Runtime API uses the transaction pooler (port 6543).
// Migrations + seeds use DATABASE_URL (session pooler 5432) — see drizzle.config.ts and seed.ts.
// ADR-185 — under the test harness only, the connection names itself so the
// stock-ledger write-lock (migration 0149) lets the suites' teardown remove
// the ledger rows they created. Never set outside NODE_ENV=test.
export const TEST_HARNESS_APP_NAME = 'innovic-test-harness';
const queryClient = postgres(env.DATABASE_URL_POOLED, {
  prepare: false,
  ...(env.NODE_ENV === 'test' ? { connection: { application_name: TEST_HARNESS_APP_NAME } } : {}),
});

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });

export type Db = typeof db;

export type DbPingResult = { ok: true } | { ok: false; error: string };

// Default timeout: 8000ms (was 2000ms before T-058). Cold-start TLS +
// pgbouncer connection setup + select 1 from a freshly-deployed Railway
// container to Supabase Mumbai (ap-south-1) routinely takes 3-5s on the
// first hit; 2s was tight enough to cause /readyz to time out → 503 →
// Railway healthcheck fail → rolled-back deploys (commits e94453e, 946a83c).
// 8s gives comfortable headroom; if a real DB blip is in progress, the
// 503 still surfaces it for monitoring.
export async function pingDatabase(timeoutMs = 8000): Promise<DbPingResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const ping = queryClient`select 1`;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`db ping timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    await Promise.race([ping, timeout]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
