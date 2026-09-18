// Global Search — data hook + the ONE place that decides where a result opens.
//
// The contract is frozen in @innovic/shared (schemas/global-search.ts):
// `GET /global-search?q=<text>&kind=<kind>` returns { items, truncated, counts }.
// The API already filters by the caller's permissions, so nothing is
// re-filtered here. The header box (components/shared/global-search.tsx) only
// launches the full-screen page (modules/search/routes/results.tsx); this
// module serves the page.

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { UseNavigateResult } from '@tanstack/react-router';
import { GLOBAL_SEARCH_MAX_CHARS, GLOBAL_SEARCH_MIN_CHARS } from '@innovic/shared';
import type { GlobalSearchKind, GlobalSearchResponse, GlobalSearchResult } from '@innovic/shared';
import { apiFetch } from '@/lib/api';

export interface UseGlobalSearchArgs {
  q: string;
  kind?: GlobalSearchKind | undefined;
}

export function useGlobalSearch({
  q,
  kind,
}: UseGlobalSearchArgs): UseQueryResult<GlobalSearchResponse> {
  // The API rejects `q` longer than GLOBAL_SEARCH_MAX_CHARS; the input also caps typing at it.
  const term = q.slice(0, GLOBAL_SEARCH_MAX_CHARS);
  return useQuery<GlobalSearchResponse>({
    queryKey: ['global-search', term, kind ?? null],
    queryFn: () =>
      apiFetch<GlobalSearchResponse>(
        `/global-search?${new URLSearchParams({ q: term, ...(kind ? { kind } : {}) }).toString()}`,
      ),
    enabled: term.length >= GLOBAL_SEARCH_MIN_CHARS,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

// ── Where a row opens ──────────────────────────────────────────────────────

/** Detail route for each kind that has its own page. Every `to` here is a
 *  registered `<x>/$id` route (see the module's routes/detail.tsx — Job Card's
 *  detail is its status page). Keep in step with related-docs-panel.tsx ROUTE_LINKS. */
const DETAIL_ROUTES: Partial<Record<GlobalSearchKind, string>> = {
  'sales-order': '/sales-orders/$id',
  'job-work-order': '/job-work-orders/$id',
  'purchase-request': '/purchase-requests/$id',
  'purchase-order': '/purchase-orders/$id',
  grn: '/goods-receipt-notes/$id',
  'delivery-challan': '/delivery-challans/$id',
  'job-card': '/job-cards/$id',
  nc: '/nc-register/$id',
  invoice: '/invoices/$id',
  plan: '/plans/$id',
  'bom-master': '/bom-masters/$id',
  'route-card': '/route-cards/$id',
  'design-project': '/design-projects/$id',
  'jw-dc-outward': '/jw-dc/$id',
  client: '/clients/$id',
  vendor: '/vendors/$id',
  item: '/items/$id',
};

interface Landing {
  to: string;
  /** URL params the host list reads to open on the right tab, filtered to the row. */
  search: (r: GlobalSearchResult) => Record<string, string>;
}

/** Kinds without a detail page open on their host list / register, filtered
 *  to the document code via `?tab=&search=` (Tasks: `?task=<id>` opens the card). */
const LANDINGS: Partial<Record<GlobalSearchKind, Landing>> = {
  'customer-dispatch': {
    to: '/customer-dispatches',
    search: (r) => ({ tab: 'so', search: r.docNo }),
  },
  'jw-return': { to: '/customer-dispatches', search: (r) => ({ tab: 'jw', search: r.docNo }) },
  'jw-invoice': { to: '/invoices', search: (r) => ({ tab: 'jw', search: r.docNo }) },
  // `capa`, not `search`: the NC list owns `?search=` for its own rows.
  capa: { to: '/nc-register', search: (r) => ({ tab: 'capa', capa: r.docNo }) },
  'store-issue': { to: '/issue-register', search: (r) => ({ tab: 'items', search: r.docNo }) },
  'tool-issue': { to: '/issue-register', search: (r) => ({ tab: 'tools', search: r.docNo }) },
  'party-grn': { to: '/party-grn', search: (r) => ({ tab: 'receive', search: r.docNo }) },
  'party-material-issue': { to: '/party-grn', search: (r) => ({ tab: 'issue', search: r.docNo }) },
  'jw-dc-inward': { to: '/jw-dc', search: (r) => ({ tab: 'inward', search: r.docNo }) },
  task: { to: '/task-board', search: (r) => ({ task: r.id }) },
  'design-tracker': { to: '/design-tracker', search: (r) => ({ search: r.docNo }) },
};

/** The kinds that open on a filtered list rather than a detail page — the
 *  Search page can show an "opens register" hint on those rows. */
export const GLOBAL_SEARCH_LANDING_KIND: ReadonlySet<GlobalSearchKind> = new Set(
  Object.keys(LANDINGS) as GlobalSearchKind[],
);

/** Open a search result: its detail page where one exists, otherwise its host
 *  list filtered to the code. Returns false when the kind is unknown to this
 *  build (a newer API could add one before the web learns its route). */
export function openSearchResult(
  navigate: UseNavigateResult<string>,
  r: GlobalSearchResult,
): boolean {
  const detail = DETAIL_ROUTES[r.kind];
  if (detail) {
    void navigate({ to: detail, params: { id: r.id } });
    return true;
  }
  const landing = LANDINGS[r.kind];
  if (landing) {
    // The host lists' `validateSearch` gain `tab` / `search` / `task` in a parallel
    // change; the cast keeps this compiling either way. A fresh object (not
    // `prev`) so `?q=&kind=` from /search never leaks into the target URL.
    void navigate({ to: landing.to, search: landing.search(r) as never });
    return true;
  }
  return false;
}
