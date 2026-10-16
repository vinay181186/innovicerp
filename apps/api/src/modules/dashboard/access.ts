// Dashboard dept-access helper. Mirror of legacy _hasDeptAccess / _getUserAccess.
// Super Admin sees everything; otherwise fullAccess or the per-dept tier
// (ADR-232, owner D10: a manager no longer sees every department).

import {
  type AccessAction,
  type AccessFormKey,
  canOpenPage,
  effectiveFormPerms,
  normalizeDeptsMap,
} from '@innovic/shared';
import type { AuthContext, FrozenAccess } from '../../db/with-user-context';
import { getMyAccess } from '../access-control/service';

export interface DashAccess {
  role: string;
  isAdmin: boolean;
  isManager: boolean;
  eff: FrozenAccess;
}

export async function loadAccess(user: AuthContext): Promise<DashAccess> {
  const eff = await getMyAccess(user);
  return {
    role: user.role,
    isAdmin: user.role === 'admin',
    isManager: user.role === 'manager',
    eff,
  };
}

export function hasDept(a: DashAccess, dept: string | null): boolean {
  if (!dept) return true;
  if (a.isAdmin) return true;
  if (a.eff.fullAccess) return true;
  // L7 Auditor reads every department by definition (0100).
  if (a.eff.auditor) return true;
  // Since 0100 the map holds a tier key, not `true` — any tier means the
  // department is theirs. `normalizeDeptsMap` also accepts pre-0100 rows.
  return normalizeDeptsMap(a.eff.departments ?? {})[dept] !== undefined;
}

/** ADR-234: a Home link / widget is shown only if its department is the
 *  user's AND the page it leads to opens for them (PAGE_ACCESS — so a per-page
 *  Hide or a missing View tick hides the link too). */
export function canSeeLink(a: DashAccess, dept: string | null, page: string): boolean {
  return hasDept(a, dept) && canOpenPage(a.eff, a.isAdmin || a.eff.fullAccess, page);
}

/** ADR-234: does the caller hold this tick? For work-list prompts — a prompt
 *  to act is shown only to someone who may do that act. */
export function hasTick(a: DashAccess, form: AccessFormKey, action: AccessAction): boolean {
  return a.isAdmin || effectiveFormPerms(a.eff, form)[action];
}

// First department the user has access to, in legacy priority order
// (_detectPrimaryDept L2522). Null if none.
const PRIMARY_DEPT_ORDER = [
  'qc',
  'purchase',
  'design',
  'sales',
  'store',
  'production',
  'finance',
  'planning',
] as const;

export function detectPrimaryDept(a: DashAccess): string | null {
  const depts = normalizeDeptsMap(a.eff.departments ?? {});
  for (const d of PRIMARY_DEPT_ORDER) {
    if (depts[d]) return d;
  }
  return null;
}
