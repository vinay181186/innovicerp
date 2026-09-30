/* eslint-disable no-console -- CLI script: its console output IS the report (same as apply-sql / seed). */
// Environment guard for every script that connects straight to a database
// (apply-sql, check-drift, data-quality). Finding S7: the only .env.local points
// at PRODUCTION, so a script must be told which database it is meant to hit and
// must refuse when DATABASE_URL is a different one.
//
// The target comes from DB_TARGET=TEST|PROD|LOCAL or a `--target <X>` flag
// (`--target=X` also works). The flag is removed from the returned args.
//   TEST  → DATABASE_URL must contain the TEST project ref, never the PROD one
//   PROD  → DATABASE_URL must contain the PROD project ref, never the TEST one
//   LOCAL → DATABASE_URL must be localhost / 127.0.0.1 / ::1 and name neither ref
// Read-only scripts may also take `--env-file <path>` (loaded here with Node's
// process.loadEnvFile) so `pnpm db:drift` / `pnpm db:quality` need no dotenv wrapper.

export const PROJECT_REFS = {
  TEST: 'uitsrhyulidubnddzcex',
  PROD: 'ctbrlcdwfddhlscnoyos',
} as const;

export type DbTarget = 'TEST' | 'PROD' | 'LOCAL';
const TARGETS: readonly DbTarget[] = ['TEST', 'PROD', 'LOCAL'];

export interface ResolvedTarget {
  target: DbTarget;
  /** argv with --target / --env-file removed */
  args: string[];
  /** the checked DATABASE_URL */
  url: string;
}

function fail(script: string, msg: string): never {
  console.error(`[${script}] REFUSED: ${msg}`);
  console.error(
    `[${script}] Set DB_TARGET to the database you mean, e.g.\n` +
      `    DB_TARGET=TEST pnpm --filter @innovic/api exec dotenv -e <test.env> -- tsx src/db/${script}.ts ...\n` +
      `  or pass --target TEST|PROD|LOCAL. DB_TARGET must match the project in DATABASE_URL\n` +
      `  (TEST = ${PROJECT_REFS.TEST}, PROD = ${PROJECT_REFS.PROD}).`,
  );
  process.exit(2);
}

function parseTarget(script: string, raw: string, source: string): DbTarget {
  const t = raw.trim().toUpperCase();
  if (!(TARGETS as readonly string[]).includes(t)) {
    fail(script, `${source} = "${raw}" is not one of TEST, PROD, LOCAL.`);
  }
  return t as DbTarget;
}

export function resolveDbTarget(
  script: string,
  argv: string[],
  opts: { allowEnvFile?: boolean } = {},
): ResolvedTarget {
  const args: string[] = [];
  let flag: DbTarget | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--env-file' && opts.allowEnvFile) {
      const f = argv[i + 1];
      if (f === undefined) fail(script, '--env-file needs a path.');
      process.loadEnvFile(f);
      i++;
    } else if (a === '--target') {
      const v = argv[i + 1];
      if (v === undefined) fail(script, '--target needs a value (TEST, PROD or LOCAL).');
      flag = parseTarget(script, v, '--target');
      i++;
    } else if (a.startsWith('--target=')) {
      flag = parseTarget(script, a.slice('--target='.length), '--target');
    } else {
      args.push(a);
    }
  }

  const envRaw = process.env['DB_TARGET'];
  const fromEnv =
    envRaw && envRaw.trim() !== '' ? parseTarget(script, envRaw, 'DB_TARGET') : undefined;
  if (flag && fromEnv && flag !== fromEnv) {
    fail(script, `DB_TARGET=${fromEnv} but --target ${flag} — they must agree.`);
  }
  const target = flag ?? fromEnv;
  if (!target) {
    fail(script, 'DB_TARGET is not set. This script will not guess which database to use.');
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) fail(script, 'DATABASE_URL is not set.');
  const hasTest = databaseUrl.includes(PROJECT_REFS.TEST);
  const hasProd = databaseUrl.includes(PROJECT_REFS.PROD);

  if (target === 'TEST' && (!hasTest || hasProd)) {
    fail(
      script,
      `DB_TARGET=TEST but DATABASE_URL is ${hasProd ? 'the PRODUCTION project' : 'not the TEST project'}.`,
    );
  }
  if (target === 'PROD' && (!hasProd || hasTest)) {
    fail(
      script,
      `DB_TARGET=PROD but DATABASE_URL is ${hasTest ? 'the TEST project' : 'not the PRODUCTION project'}.`,
    );
  }
  if (target === 'LOCAL') {
    let host = '';
    try {
      host = new URL(databaseUrl).hostname;
    } catch {
      fail(script, 'DATABASE_URL is not a valid URL.');
    }
    if (hasTest || hasProd || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      fail(script, `DB_TARGET=LOCAL but DATABASE_URL host is "${host}", not this machine.`);
    }
  }

  console.log(`[${script}] target: ${target}`);
  return { target, args, url: databaseUrl };
}
