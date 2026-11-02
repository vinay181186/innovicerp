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
// Each check runs in its own short transaction, CHECKS_PARALLEL at a time,
// guarded: one failing query drops only that check (logged), never the page.
// Empty departments are omitted.

import { DASH_CHECK_DEPTS, type DashCheck, type DashChecksResponse } from '@innovic/shared';
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
import { type CheckCtx, type CheckDef, type CheckResult, runCheck, toCheck } from './types';

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

/** Run `defs` CHECKS_PARALLEL at a time through `run`. A check that throws is
 *  logged and left out; the rest still build. Money checks are masked for a
 *  caller without the Price right (canSeePrice). Registry order is kept. */
export async function buildChecks(
  defs: readonly CheckDef[],
  c: CheckCtx,
  a: DashAccess,
  run: CheckRunner,
): Promise<DashCheck[]> {
  const built = await inParallel<DashCheck | null>(
    defs.map((d) => async () => {
      try {
        return toCheck(d, await run(d), c.today, canSeePrice(a, d.priceForm));
      } catch (err) {
        logger.error({ err, check: d.key }, 'dashboard check failed');
        return null;
      }
    }),
  );
  return built.filter((x): x is DashCheck => x !== null);
}

export async function getChecks(user: AuthContext): Promise<DashChecksResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const c: CheckCtx = { cid: user.companyId, today: istToday() };
  const a = await loadAccess(user);
  const built = await buildChecks(visibleChecks(a), c, a, (d) =>
    withUserContext(user, (tx) => runCheck(tx, d.query(c), c.today)),
  );
  return toDeptBlocks(built);
}
