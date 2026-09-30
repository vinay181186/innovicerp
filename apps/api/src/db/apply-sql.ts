// One-off applier for hand-written SQL migrations that drizzle-kit doesn't manage
// (triggers, views, anything outside the schema graph).
//
// Usage (DB_TARGET is REQUIRED — finding S7 environment guard, see db-target.ts):
//   DB_TARGET=TEST pnpm --filter @innovic/api exec dotenv -e <test.env> -- tsx src/db/apply-sql.ts <path1> ...
//   DB_TARGET=PROD pnpm exec dotenv -e <prod.env> -- tsx src/db/apply-sql.ts <path1> ...
//   (or `--target TEST|PROD|LOCAL` anywhere in the argument list)
// The run is refused when DATABASE_URL is not the project named by DB_TARGET
// (TEST = uitsrhyulidubnddzcex, PROD = ctbrlcdwfddhlscnoyos).
//
// Statements are split on `--> statement-breakpoint` markers (the same convention
// drizzle-kit uses inside its generated files) and run in order on ONE connection.
//
// Transactions: each file runs inside ONE transaction (all statements commit
// together or none do) EXCEPT when the file
//   - carries the marker comment `-- no-transaction` (put it on its own line;
//     needed for CREATE INDEX CONCURRENTLY, VACUUM, …), or
//   - manages its own transaction (a `BEGIN;` / `COMMIT;` line — 0128, 0153, 0160 …), or
//   - adds an enum value (`ALTER TYPE … ADD VALUE`): Postgres cannot use a new enum
//     value in the transaction that added it (0153, 0175 …).
// Those files run statement by statement, as before, and the reason is printed.
//
// Migration record: after a file succeeds, a row is upserted into
// public.schema_migrations (filename, checksum, applied_at, applied_by, target) —
// inside the same transaction when the file is wrapped. The write is skipped when
// the table does not exist yet (so 0180, which creates it, can be applied).

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { basename, resolve } from 'node:path';
import postgres from 'postgres';
import { env } from '../lib/env';
import { resolveDbTarget, type DbTarget } from './db-target';

const { target, args: files } = resolveDbTarget('apply-sql', process.argv.slice(2));
if (files.length === 0) {
  console.error('Usage: DB_TARGET=TEST|PROD tsx src/db/apply-sql.ts <path1.sql> [path2.sql ...]');
  process.exit(1);
}

function splitStatements(text: string): string[] {
  return (
    text
      .split(/-->\s*statement-breakpoint/i)
      .map((s) => s.trim())
      // Drop chunks that are comment-only, checked line by line. The old regex
      // /^(--.*\n?)+$/ backtracks exponentially on a long comment header that
      // is followed by SQL — 0128's walk-through table hung it for minutes
      // before the first statement ever reached the database.
      .filter(
        (s) =>
          s.length > 0 &&
          !s.split('\n').every((line) => line.trim() === '' || line.trimStart().startsWith('--')),
      )
  );
}

/** Why a file must NOT be wrapped in one transaction, or null to wrap it. */
function noWrapReason(text: string): string | null {
  if (/^\s*--\s*no-transaction\b/im.test(text)) return 'marker "-- no-transaction"';
  if (/^\s*(BEGIN|COMMIT|START\s+TRANSACTION|ROLLBACK)\s*;/im.test(text)) {
    return 'file manages its own BEGIN/COMMIT';
  }
  // Only real statements, not comments that mention it.
  const code = text
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
  if (/ALTER\s+TYPE\s+[\w."]+\s+ADD\s+VALUE/i.test(code)) {
    return 'ALTER TYPE … ADD VALUE cannot be used in the same transaction';
  }
  return null;
}

type Runner = Pick<postgres.Sql, 'unsafe'>;

async function runStatements(db: Runner, statements: string[]): Promise<void> {
  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.split('\n').slice(0, 2).join(' ').slice(0, 80);
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
    await db.unsafe(stmt);
    console.log('ok');
  }
}

async function recordMigration(
  db: Runner,
  filename: string,
  checksum: string,
  runTarget: DbTarget,
): Promise<void> {
  const [reg] = await db.unsafe<{ t: string | null }[]>(
    `SELECT to_regclass('public.schema_migrations')::text AS t`,
  );
  if (!reg?.t) {
    console.log('  (schema_migrations not present yet — record skipped)');
    return;
  }
  const [prev] = await db.unsafe<{ checksum: string }[]>(
    `SELECT checksum FROM public.schema_migrations WHERE filename = $1`,
    [filename],
  );
  if (prev && prev.checksum !== checksum) {
    console.log(`  NOTE: ${filename} was applied before with a DIFFERENT file content.`);
  }
  const by = `${userInfo().username}@${hostname()}`;
  await db.unsafe(
    `INSERT INTO public.schema_migrations (filename, checksum, applied_at, applied_by, target)
     VALUES ($1, $2, now(), $3, $4)
     ON CONFLICT (filename) DO UPDATE
       SET checksum = EXCLUDED.checksum, applied_at = now(),
           applied_by = EXCLUDED.applied_by, target = EXCLUDED.target`,
    [filename, checksum, by, runTarget],
  );
  console.log(`  recorded in schema_migrations (${target})`);
}

const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });

try {
  for (const file of files) {
    const path = resolve(file);
    const text = await readFile(path, 'utf8');
    const checksum = createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
    const filename = basename(path);
    const statements = splitStatements(text);
    const reason = noWrapReason(text);

    console.log(
      `[apply-sql] ${path} → ${statements.length} statement(s), ` +
        (reason ? `NO transaction wrap (${reason})` : 'one transaction'),
    );
    if (reason) {
      await runStatements(sql, statements);
      await recordMigration(sql, filename, checksum, target);
    } else {
      // Any error rolls the whole file back (postgres.js issues ROLLBACK).
      await sql.begin(async (tx) => {
        await runStatements(tx, statements);
        await recordMigration(tx, filename, checksum, target);
      });
      console.log('  committed');
    }
  }
  console.log('[apply-sql] done');
} catch (err) {
  console.error(`\n[apply-sql] FAILED: ${(err as Error).message}`);
  console.error(
    '[apply-sql] A "one transaction" file was rolled back in full; a NO-wrap file keeps the ' +
      'statements that printed "ok". Later files were not run.',
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
