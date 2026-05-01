// One-off applier for hand-written SQL migrations that drizzle-kit doesn't manage
// (triggers, views, anything outside the schema graph).
// Usage: pnpm --filter api exec dotenv -e ../../.env.local -- tsx src/db/apply-sql.ts <path1> <path2> ...
//
// Statements are split on `--> statement-breakpoint` markers (the same convention
// drizzle-kit uses inside its generated files). Each statement runs sequentially
// inside a single connection. CREATE OR REPLACE makes re-runs safe.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { env } from '../lib/env';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: tsx src/db/apply-sql.ts <path1.sql> [path2.sql ...]');
  process.exit(1);
}

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });

try {
  for (const file of files) {
    const path = resolve(file);
    const text = await readFile(path, 'utf8');
    const statements = text
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !/^(--.*\n?)+$/.test(s));

    console.log(`[apply-sql] ${path} → ${statements.length} statement(s)`);
    for (const [i, stmt] of statements.entries()) {
      const preview = stmt.split('\n').slice(0, 2).join(' ').slice(0, 80);
      process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
      await sql.unsafe(stmt);
      console.log('ok');
    }
  }
  console.log('[apply-sql] done');
} finally {
  await sql.end();
}
