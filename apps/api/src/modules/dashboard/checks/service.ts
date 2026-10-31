// ADR-264 — GET /dashboard/checks: the department pages of the new home.
// Read-only. Access is read ONCE for the request (ADR-229, as home-service):
// the department access tier decides (owner decision 2026-10-31): a check is
// shown to anyone with a tier in its department (hasDept), whether or not its
// "View all" page opens for them. The web renders the document, reference and
// View-all links through <ActionLink fallback="text">, so a page the caller
// cannot open reads as plain text. Admin / Full Access see every check. Each
// check runs in its own short transaction, guarded: one failing query drops
// only that check (logged), never the page. Empty departments are omitted.

import { DASH_CHECK_DEPTS, type DashCheck, type DashChecksResponse } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../../db/with-user-context';
import { AuthorizationError } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import { type DashAccess, hasDept, loadAccess } from '../access';
import { istToday } from '../personal/util';
import { PLANNING_CHECKS } from './planning';
import { PRODUCTION_CHECKS } from './production';
import { PURCHASE_CHECKS } from './purchase';
import { SALES_CHECKS } from './sales';
import { STORE_CHECKS } from './store';
import { type CheckCtx, type CheckDef, runCheck, toCheck } from './types';

/** Every check, in menu order (DASH_CHECK_DEPTS), then registry order. */
export const CHECK_DEFS: readonly CheckDef[] = [
  ...SALES_CHECKS,
  ...PRODUCTION_CHECKS,
  ...PURCHASE_CHECKS,
  ...STORE_CHECKS,
  ...PLANNING_CHECKS,
];

/** How many checks read at once — each holds one pool connection. */
const CHECKS_PARALLEL = 4;

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

export async function getChecks(user: AuthContext): Promise<DashChecksResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const c: CheckCtx = { cid: user.companyId, today: istToday() };
  const a = await loadAccess(user);
  const defs = visibleChecks(a);
  const built = await inParallel<DashCheck | null>(
    defs.map((d) => async () => {
      try {
        const res = await withUserContext(user, (tx) => runCheck(tx, d.query(c), c.today));
        return toCheck(d, res, c.today);
      } catch (err) {
        logger.error({ err, check: d.key }, 'dashboard check failed');
        return null;
      }
    }),
  );
  return toDeptBlocks(built.filter((x): x is DashCheck => x !== null));
}
