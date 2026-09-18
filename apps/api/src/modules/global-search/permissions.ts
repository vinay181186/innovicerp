// Which search kinds may this caller see?
//
// Kept in its own file with NO database imports so the unit test can load it
// without opening a connection. The rule mirrors `requireFormAccess`
// (lib/access.ts): admins bypass the matrix entirely; everyone else gets a
// kind only when its Access Control gate passes — the form key's
// `effectiveFormPerms(eff, formKey).view` (which already folds in department
// tier, per-form grants, the auditor flag, and the "Hide page" (viewOff)
// switch), ALL of a `formKeys` list (a tab inside a host page), or, for kinds gated by a department with no form keys (Tasks),
// `hasDeptAccess(eff, dept)`. Both deny everything when `eff` is null or
// unconfigured. A kind that is not in this list is never queried, so no row,
// count or metadata for a hidden page ever leaves the server.

import {
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_KINDS,
  effectiveFormPerms,
  hasDeptAccess,
  type EffectiveAccess,
  type GlobalSearchKind,
  type UserRole,
} from '@innovic/shared';

export function allowedSearchKinds(
  user: { role: UserRole },
  eff: EffectiveAccess | null,
): GlobalSearchKind[] {
  if (user.role === 'admin') return [...GLOBAL_SEARCH_KINDS];
  return GLOBAL_SEARCH_KINDS.filter((k) => {
    const gate = GLOBAL_SEARCH_KIND_META[k].gate;
    if ('formKeys' in gate) return gate.formKeys.every((fk) => effectiveFormPerms(eff, fk).view);
    if (gate.formKey !== undefined) return effectiveFormPerms(eff, gate.formKey).view;
    return gate.dept !== undefined ? hasDeptAccess(eff, gate.dept) : false;
  });
}
