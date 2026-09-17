// Global Search service — the header search box.
//
// One read-only endpoint looks across every document kind that has its own
// detail screen and returns rows shaped for Date | Particulars | Type | Doc No.
// The query is a UNION ALL over a per-kind registry (same idea as the trash
// module), but built from drizzle `sql` fragments so the company id, the
// search term and the limit are bound parameters — never string-concatenated.
//
// Permissions: the caller's effective access is loaded ONCE (getMyAccess) and
// `allowedSearchKinds` decides which kinds are even queried. A kind the user
// may not view is not in the UNION at all, so no row, count or metadata for a
// hidden page leaves the server. Admins bypass, matching requireFormAccess.
// A user with nothing viewable gets an empty 200 — the header box must never
// throw 403 for a viewer.
//
// Particulars never carry money: only party names, item codes/names, PO/SO
// refs and the like, so a row is safe for every tier that can open the page.

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { getMyAccess } from '../access-control/service';
import { allowedSearchKinds } from './permissions';
import { buildSearchSql } from './query';
import type {
  GlobalSearchKind,
  GlobalSearchQuery,
  GlobalSearchResponse,
  GlobalSearchResult,
} from './schema';

type Row = {
  kind: GlobalSearchKind;
  id: string;
  doc_no: string;
  doc_date: string | null;
  particulars: string | null;
  status: string | null;
};

export async function globalSearch(
  input: GlobalSearchQuery,
  user: AuthContext,
): Promise<GlobalSearchResponse> {
  // A login that has not been assigned to a company yet has nothing to search.
  // Answer empty (200) rather than throwing: this endpoint fires on every
  // keystroke in the header, and a red error there on every page is worse
  // than an empty list. Same posture as the no-viewable-kinds path below.
  const companyId = user.companyId;
  if (!companyId) return { items: [], truncated: false };

  // One access read per request, then decide the kinds up front. Admins skip
  // the read entirely (they bypass the matrix, same as requireFormAccess).
  const eff = user.role === 'admin' ? null : await getMyAccess(user);
  const kinds = allowedSearchKinds(user, eff);
  if (kinds.length === 0) return { items: [], truncated: false };

  const rows = await withUserContext(user, async (tx) => {
    const result = await tx.execute(buildSearchSql(kinds, companyId, input.q, input.limit));
    return result as unknown as Row[];
  });

  const truncated = rows.length > input.limit;
  const items: GlobalSearchResult[] = rows.slice(0, input.limit).map((r) => ({
    kind: r.kind,
    id: r.id,
    docNo: r.doc_no,
    date: r.doc_date ?? null,
    particulars: r.particulars ?? '',
    status: r.status ?? null,
  }));

  return { items, truncated };
}
