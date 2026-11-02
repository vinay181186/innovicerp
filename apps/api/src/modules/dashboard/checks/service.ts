// ADR-264 — GET /dashboard/checks: the department pages of the new home.
// Read-only. Access is read ONCE for the request (ADR-229, as home-service):
// the department access tier decides (owner decision 2026-10-31): a check is
// shown to anyone with a tier in its department (hasDept), whether or not its
// "View all" page opens for them. The web renders the document, reference and
// View-all links through <ActionLink fallback="text">, so a page the caller
// cannot open reads as plain text. Admin / Full Access see every check. A
// money check (priceForm) shows its amounts only to a caller with the Price
// right on that page (canSeePrice); otherwise its qty / uom are null.
//
// FAST PATH (phase 2 speed, owner target ≤ 3 s): ONE transaction, ONE
// statement for every visible check (fastChecksSql) — each check's figures are
// checkSummarySql (types.ts), the same definition runCheck uses, so the two
// paths cannot disagree. FALLBACK: if that statement fails (one broken check
// fails it all), it is logged once and every check runs in its own short
// transaction, CHECKS_PARALLEL at a time, guarded: one failing query drops only
// that check (logged), never the page. Empty departments are omitted.

import { DASH_CHECK_DEPTS, type DashCheck, type DashChecksResponse } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../../db/with-user-context';
import { AuthorizationError } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import { type DashAccess, canSeePrice, hasDept, loadAccess } from '../access';
import { istToday } from '../personal/util';
import { DESIGN_CHECKS } from './design';
import { FINANCE_CHECKS } from './finance';
import { PLANNING_CHECKS } from './planning';
import { PRODUCTION_CHECKS } from './production';
import { PURCHASE_CHECKS } from './purchase';
import { QC_CHECKS } from './qc';
import { SALES_CHECKS } from './sales';
import { STORE_CHECKS } from './store';
import {
  type CheckCtx,
  type CheckDef,
  type CheckResult,
  checkSummarySql,
  parseCheckSummary,
  runCheck,
  toCheck,
} from './types';

/** Every check. Menu order is DASH_CHECK_DEPTS (toDeptBlocks); inside a
 *  department, this registry order. */
export const CHECK_DEFS: readonly CheckDef[] = [
  ...SALES_CHECKS,
  ...DESIGN_CHECKS,
  ...PLANNING_CHECKS,
  ...PRODUCTION_CHECKS,
  ...PURCHASE_CHECKS,
  ...STORE_CHECKS,
  ...QC_CHECKS,
  ...FINANCE_CHECKS,
];

/** The checks this caller may see: every check of a department they hold a
 *  tier in (hasDept is true for admin / Full Access). */
export function visibleChecks(a: DashAccess): CheckDef[] {
  return CHECK_DEFS.filter((d) => hasDept(a, d.dept));
}

/** Group built checks into department blocks; departments with no check are
 *  left out. `total` = the sum of the department's counts (the menu badge). */
export function toDeptBlocks(checks: readonly DashCheck[]): DashChecksResponse {
  return {
    depts: DASH_CHECK_DEPTS.map((dept) => {
      const mine = checks.filter((c) => c.dept === dept);
      return { dept, total: mine.reduce((s, c) => s + c.count, 0), checks: mine };
    }).filter((b) => b.checks.length > 0),
  };
}

/** How many checks read at once — each holds one pool connection. */
const CHECKS_PARALLEL = 4;

async function inParallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHECKS_PARALLEL, tasks.length) }, worker));
  return out;
}

/** Reads one check's rows (getChecks: its own short transaction). */
export type CheckRunner = (d: CheckDef) => Promise<CheckResult>;

/** What to do when one check fails on its own (default: log it). */
export type CheckFailHandler = (d: CheckDef, err: unknown) => void;

const logCheckFailed: CheckFailHandler = (d, err) => {
  logger.error({ err, check: d.key }, 'dashboard check failed');
};

/** A check result → the contract check, money masked for a caller without
 *  the Price right on its page (canSeePrice). */
const finish = (d: CheckDef, res: CheckResult, c: CheckCtx, a: DashAccess): DashCheck =>
  toCheck(d, res, c.today, canSeePrice(a, d.priceForm));

/** Run `defs` CHECKS_PARALLEL at a time through `run`. A check that throws is
 *  handed to `onFail` (logged) and left out; the rest still build. Registry
 *  order is kept. */
export async function buildChecks(
  defs: readonly CheckDef[],
  c: CheckCtx,
  a: DashAccess,
  run: CheckRunner,
  onFail: CheckFailHandler = logCheckFailed,
): Promise<DashCheck[]> {
  const built = await inParallel<DashCheck | null>(
    defs.map((d) => async () => {
      try {
        return finish(d, await run(d), c, a);
      } catch (err) {
        onFail(d, err);
        return null;
      }
    }),
  );
  return built.filter((x): x is DashCheck => x !== null);
}

// ── Broken-check memory (in-process) ──
// A check that fails ON ITS OWN is remembered for CHECK_QUARANTINE_MS: it is
// left out of the fast statement (so one broken check cannot make every
// request pay the failed big statement + the whole fallback) and runs alone
// through the per-check runner instead — still dropped if it fails, logged
// only once per window. When the window ends it rejoins the fast statement.

export const CHECK_QUARANTINE_MS = 10 * 60 * 1000;
/** check key → the time (ms) it may rejoin the fast statement. */
const quarantine = new Map<string, number>();

function isQuarantined(key: string, now: number): boolean {
  const until = quarantine.get(key);
  if (until === undefined) return false;
  if (now >= until) {
    quarantine.delete(key);
    return false;
  }
  return true;
}

/** Tests only: forget every remembered check. */
export function resetCheckQuarantine(): void {
  quarantine.clear();
}

/** jsonb_build_object takes at most 100 arguments: 40 key/value pairs per
 *  object, objects joined with `||`. */
const FAST_PAIRS_PER_OBJECT = 40;

/** ONE statement for every check in `defs`: a single jsonb object
 *  { <check key>: checkSummarySql(<its query>) , … } in column `j`. */
export function fastChecksSql(defs: readonly CheckDef[], c: CheckCtx): SQL {
  const parts: SQL[] = [];
  for (let i = 0; i < defs.length; i += FAST_PAIRS_PER_OBJECT) {
    const pairs = defs
      .slice(i, i + FAST_PAIRS_PER_OBJECT)
      .map((d) => sql`${d.key}::text, ${checkSummarySql(d.query(c), c.today)}`);
    parts.push(sql`jsonb_build_object(${sql.join(pairs, sql`, `)})`);
  }
  return sql`SELECT ${sql.join(parts, sql` || `)} AS j`;
}

export interface CheckReaders {
  /** Runs fastChecksSql(defs) and returns its `j` value. */
  fast: (defs: readonly CheckDef[]) => Promise<unknown>;
  /** One check in its own transaction (the fallback). */
  one: CheckRunner;
}

/** Fast path first (every check not remembered as broken, in ONE
 *  statement). Run alone through `readers.one`: the remembered checks, every
 *  check when the single statement fails (logged once), and any check whose
 *  entry in a successful fast result is missing or malformed. A check that
 *  fails alone is dropped and remembered. Registry order is kept. */
export async function loadChecks(
  defs: readonly CheckDef[],
  c: CheckCtx,
  a: DashAccess,
  readers: CheckReaders,
  now: number = Date.now(),
): Promise<DashCheck[]> {
  if (defs.length === 0) return [];
  const remembered = new Set(defs.filter((d) => isQuarantined(d.key, now)).map((d) => d.key));
  const fastDefs = defs.filter((d) => !remembered.has(d.key));
  const done = new Map<string, DashCheck>();
  let alone: CheckDef[] = defs.filter((d) => remembered.has(d.key));

  if (fastDefs.length > 0) {
    let all: Record<string, unknown> | null = null;
    try {
      const j = await readers.fast(fastDefs);
      const o: unknown = typeof j === 'string' ? JSON.parse(j) : j;
      if (!o || typeof o !== 'object') throw new Error('fast path returned no object');
      all = o as Record<string, unknown>;
    } catch (err) {
      logger.error({ err, checks: fastDefs.length }, 'dashboard checks fast path failed');
    }
    if (all) {
      // Pure parsing — mapped synchronously, no worker pool.
      for (const d of fastDefs) {
        try {
          done.set(d.key, finish(d, parseCheckSummary(all[d.key]), c, a));
        } catch {
          alone.push(d); // missing / malformed: retry this check on its own
        }
      }
    } else {
      alone = alone.concat(fastDefs);
    }
  }

  if (alone.length > 0) {
    const solo = await buildChecks(alone, c, a, readers.one, (d, err) => {
      // Log once per key per window: a remembered key failing again is quiet.
      if (remembered.has(d.key)) return;
      quarantine.set(d.key, now + CHECK_QUARANTINE_MS);
      logger.error({ err, check: d.key }, 'dashboard check failed');
    });
    for (const x of solo) done.set(x.key, x);
  }
  return defs.flatMap((d) => {
    const x = done.get(d.key);
    return x ? [x] : [];
  });
}

export async function getChecks(user: AuthContext): Promise<DashChecksResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const c: CheckCtx = { cid: user.companyId, today: istToday() };
  const a = await loadAccess(user);
  const built = await loadChecks(visibleChecks(a), c, a, {
    fast: (defs) =>
      withUserContext(user, async (tx) => {
        const res = (await tx.execute(fastChecksSql(defs, c))) as unknown as Array<
          Record<string, unknown>
        >;
        return res[0]?.['j'];
      }),
    one: (d) => withUserContext(user, (tx) => runCheck(tx, d.query(c), c.today)),
  });
  return toDeptBlocks(built);
}
