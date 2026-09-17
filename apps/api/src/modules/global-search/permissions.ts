// Which search kinds may this caller see?
//
// Kept in its own file with NO database imports so the unit test can load it
// without opening a connection. The rule mirrors `requireFormAccess`
// (lib/access.ts): admins bypass the matrix entirely; everyone else gets a
// kind only when `effectiveFormPerms(eff, formKey).view` is true — which
// already folds in department tier, per-form grants, the auditor flag, and
// the "Hide page" (viewOff) switch, and denies everything when `eff` is null
// or unconfigured. A kind that is not in this list is never queried, so no
// row, count or metadata for a hidden page ever leaves the server.

import {
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_KINDS,
  effectiveFormPerms,
  type EffectiveAccess,
  type GlobalSearchKind,
  type UserRole,
} from '@innovic/shared';

export function allowedSearchKinds(
  user: { role: UserRole },
  eff: EffectiveAccess | null,
): GlobalSearchKind[] {
  if (user.role === 'admin') return [...GLOBAL_SEARCH_KINDS];
  return GLOBAL_SEARCH_KINDS.filter(
    (k) => effectiveFormPerms(eff, GLOBAL_SEARCH_KIND_META[k].formKey).view,
  );
}
