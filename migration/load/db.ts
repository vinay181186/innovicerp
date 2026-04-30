// Drizzle + postgres client for the load layer.
//
// Migration loads use the SESSION POOLER (port 5432, DATABASE_URL) and the
// service role implicit via process.env — RLS is bypassed when we're not
// setting JWT claims, which is the desired behaviour for one-time loads.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is not set; load script needs the session pooler URL');
}

const sql = postgres(url, { max: 4, prepare: false });

export const db = drizzle(sql);
export const rawSql = sql;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
