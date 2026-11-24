// Dashboard dept-access helper. Mirror of legacy _hasDeptAccess / _getUserAccess.
// Super Admin sees everything; otherwise fullAccess or the per-dept tier
// (ADR-232, owner D10: a manager no longer sees every department).

import {
  type AccessAction,
  type AccessFormKey,
  canOpenPage,
  canSeeDeptMenu,
  effectiveFormPerms,
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
  // THE top-menu rule (canSeeDeptMenu, shared): the home's left menu shows a
  // department exactly when the top menu does (owner 2026-11-24).
  return canSeeDeptMenu(a.eff, a.isAdmin, dept);
}

/** ADR-234: a Home link / widget is shown only if its department is the
 *  user's AND the page it leads to opens for them (PAGE_ACCESS — so a per-page
 *  Hide or a missing View tick hides the link too). */
export function canSeeLink(a: DashAccess, dept: string | null, page: string): boolean {
  return hasDept(a, dept) && canOpenPage(a.eff, a.isAdmin || a.eff.fullAccess, page);
}

/** A widget = its link rule, plus — for a money widget (`priceForm`) — the
 *  Price right on that page, the same per-page rule the screens use. */
export function canSeeWidget(
  a: DashAccess,
  w: { dept: string | null; navPage: string; priceForm?: AccessFormKey },
): boolean {
  if (!canSeeLink(a, w.dept, w.navPage)) return false;
  return canSeePrice(a, w.priceForm);
}

/** The Price right on a page (the same per-page rule the screens use); no
 *  form = nothing to hide. Admins always see prices. */
export function canSeePrice(a: DashAccess, form: AccessFormKey | null | undefined): boolean {
  return !form || a.isAdmin || effectiveFormPerms(a.eff, form).price;
}

/** ADR-234: does the caller hold this tick? For work-list prompts — a prompt
 *  to act is shown only to someone who may do that act. */
export function hasTick(a: DashAccess, form: AccessFormKey, action: AccessAction): boolean {
  return a.isAdmin || effectiveFormPerms(a.eff, form)[action];
}
