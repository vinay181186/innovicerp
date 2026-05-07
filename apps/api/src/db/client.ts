import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema';

// Runtime API uses the transaction pooler (port 6543).
// Migrations + seeds use DATABASE_URL (session pooler 5432) — see drizzle.config.ts and seed.ts.
const queryClient = postgres(env.DATABASE_URL_POOLED, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });

export type Db = typeof db;

export type DbPingResult = { ok: true } | { ok: false; error: string };

export async function pingDatabase(timeoutMs = 2000): Promise<DbPingResult> {
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
