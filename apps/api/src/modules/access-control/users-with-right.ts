// ADR-250 — who holds one right (form + action)? The generalised form of
// listDeptUserOptions' join (service.ts): users + user_access →
// toEffectiveAccess → effectiveFormPerms, so the answer is the app's own
// permission check and can never disagree with the screens.
//
// Used by the per-person home for "with <name>" and the Remind target.
// Full Access accounts and role admins are left out unless asked for: an
// admin MAY do every step, but is rarely the person whose job it is.

import {
  ACCESS_FORMS,
  type AccessAction,
  type AccessFormKey,
  effectiveFormPerms,
} from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { userAccess, users } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { toEffectiveAccess } from './my-access';

export interface RightHolder {
  id: string;
  name: string;
  /** Full Access (L6) or role admin. */
  isAdmin: boolean;
  /** users.role — what loadApprovalContext asks for its admin shortcut. */
  role: string;
}

/** Active users of the company holding `action` on `form`. Their main
 *  department first (the team whose job it is), then by name. */
export async function listUsersWithRight(
  tx: DbTransaction,
  companyId: string,
  form: AccessFormKey,
  action: AccessAction,
  opts: { includeAdmins?: boolean } = {},
): Promise<RightHolder[]> {
  const rows = await tx
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      acFullAccess: userAccess.fullAccess,
      acAuditor: userAccess.auditor,
      acMainDept: userAccess.mainDept,
      acDepartments: userAccess.departments,
      acForms: userAccess.forms,
    })
    .from(users)
    .leftJoin(
      userAccess,
      and(
        eq(userAccess.userId, users.id),
        eq(userAccess.companyId, companyId),
        isNull(userAccess.deletedAt),
      ),
    )
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true), isNull(users.deletedAt)));

  const dept = ACCESS_FORMS.find((f) => f.key === form)?.dept ?? null;
  const out: Array<RightHolder & { _team: boolean }> = [];
  for (const r of rows) {
    const isAdmin = r.role === 'admin' || (r.acFullAccess ?? false);
    if (isAdmin && !opts.includeAdmins) continue;
    const eff = toEffectiveAccess({
      fullAccess: r.acFullAccess,
      auditor: r.acAuditor,
      drawingDownload: false,
      departments: r.acDepartments,
      forms: r.acForms,
    });
    if (!isAdmin && !effectiveFormPerms(eff, form)[action]) continue;
    out.push({
      id: r.id,
      name: r.fullName?.trim() || r.email,
      isAdmin,
      role: r.role,
      _team: dept !== null && r.acMainDept === dept,
    });
  }
  return out
    .sort((a, b) => (a._team === b._team ? a.name.localeCompare(b.name) : a._team ? -1 : 1))
    .map(({ _team: _drop, ...h }) => h);
}
