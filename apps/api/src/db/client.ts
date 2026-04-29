import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema';

// Runtime API uses the transaction pooler (port 6543).
// Migrations + seeds use DATABASE_URL (session pooler 5432) — see drizzle.config.ts and seed.ts.
const queryClient = postgres(env.DATABASE_URL_POOLED, { prepare: false });

export const db = drizzle(queryClient, { schema, casing: 'snake_case' });

export type Db = typeof db;
