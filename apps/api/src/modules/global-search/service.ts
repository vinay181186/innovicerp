// Global Search service — "search anything" from the box in the common top header.
//
// One read-only endpoint looks across every document / master / register kind
// and returns rows shaped for Date | Type | Doc No. | Party | Particulars |
// Qty | Status, plus a per-kind count for the count strip. The query is a
// UNION ALL over a per-kind registry (kinds-docs.ts / kinds-registers.ts),
// built from drizzle `sql` fragments so the company id, the search term and
// the limit are bound parameters — never string-concatenated.
//
// Permissions: the caller's effective access is loaded ONCE (getMyAccess) and
// `allowedSearchKinds` decides which kinds are even queried. A kind the user
// may not view is not in the UNION at all, so no row, count or metadata for a
// hidden page leaves the server (a hidden kind is ABSENT from `counts`, never
// 0). Admins bypass, matching requireFormAccess. A user with nothing viewable
// gets an empty 200 — the header box must never throw 403 for a viewer.
//
// `kind` narrows the page to one kind; the counts still cover every allowed
// kind so the strip keeps showing where else the term appears. Asking for a
// kind the caller may not view answers an empty page (with counts) — same
// posture as a hidden page, never a 403.
//
// Rows never carry money: only codes, names, refs, quantities and remarks, so
// a row is safe for every tier that can open the page.

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { getMyAccess } from '../access-control/service';
import { allowedSearchKinds } from './permissions';
import { buildCountSql, buildSearchSql } from './query';
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
  party: string | null;
  /** jsonb array of text — the driver hands it back parsed; tolerate a string too. */
  lines: unknown;
  qty: string | null;
  status: string | null;
  hit: string | null;
};

type CountRow = { kind: GlobalSearchKind; n: number };

function parseLines(raw: unknown): string[] {
  const arr = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === 'string' && x !== '');
}

export async function globalSearch(
  input: GlobalSearchQuery,
  user: AuthContext,
): Promise<GlobalSearchResponse> {
  // A login that has not been assigned to a company yet has nothing to search.
  // Answer empty (200) rather than throwing: this endpoint fires on every
  // keystroke in the header, and a red error there on every page is worse
  // than an empty list. Same posture as the no-viewable-kinds path below.
  const companyId = user.companyId;
  if (!companyId) return { items: [], truncated: false, counts: {} };

  // One access read per request, then decide the kinds up front. Admins skip
  // the read entirely (they bypass the matrix, same as requireFormAccess).
  const eff = user.role === 'admin' ? null : await getMyAccess(user);
  const kinds = allowedSearchKinds(user, eff);
  if (kinds.length === 0) return { items: [], truncated: false, counts: {} };

  // The page is restricted to the requested kind (if viewable); the counts
  // are always over every allowed kind.
  const pageKinds: GlobalSearchKind[] = input.kind
    ? kinds.includes(input.kind)
      ? [input.kind]
      : []
    : kinds;

  const { rows, countRows } = await withUserContext(user, async (tx) => {
    const countRows = (await tx.execute(
      buildCountSql(kinds, companyId, input.q),
    )) as unknown as CountRow[];
    const rows =
      pageKinds.length === 0
        ? []
        : ((await tx.execute(
            buildSearchSql(pageKinds, companyId, input.q, input.limit),
          )) as unknown as Row[]);
    return { rows, countRows };
  });

  const counts: Partial<Record<GlobalSearchKind, number>> = {};
  for (const c of countRows) counts[c.kind] = Number(c.n);

  const truncated = rows.length > input.limit;
  const items: GlobalSearchResult[] = rows.slice(0, input.limit).map((r) => ({
    kind: r.kind,
    id: r.id,
    docNo: r.doc_no,
    date: r.doc_date ?? null,
    party: r.party ?? null,
    lines: parseLines(r.lines),
    qty: r.qty ?? null,
    status: r.status ?? null,
    hit: r.hit ?? null,
  }));

  return { items, truncated, counts };
}
