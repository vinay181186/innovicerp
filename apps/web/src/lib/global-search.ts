// Global Search — data hook + route map for the header search box.
//
// The contract is frozen in @innovic/shared (schemas/global-search.ts):
// `GET /global-search?q=<text>` returns { items, truncated }. The API already
// filters by the caller's permissions, so nothing is re-filtered here.

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { GLOBAL_SEARCH_MAX_CHARS, GLOBAL_SEARCH_MIN_CHARS } from '@innovic/shared';
import type { GlobalSearchKind, GlobalSearchResponse } from '@innovic/shared';
import { apiFetch } from '@/lib/api';

/** Detail route for each result kind. Every `to` here is a registered
 *  `<x>/$id` route (see the module's routes/detail.tsx — Job Card's detail is
 *  its status page). Keep in step with related-docs-panel.tsx ROUTE_LINKS. */
export const GLOBAL_SEARCH_ROUTES: Record<GlobalSearchKind, string> = {
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
  client: '/clients/$id',
  vendor: '/vendors/$id',
  item: '/items/$id',
};

export function useGlobalSearch(rawTerm: string): UseQueryResult<GlobalSearchResponse> {
  // The API rejects `q` longer than GLOBAL_SEARCH_MAX_CHARS; the input also caps typing at it.
  const term = rawTerm.slice(0, GLOBAL_SEARCH_MAX_CHARS);
  return useQuery<GlobalSearchResponse>({
    queryKey: ['global-search', term],
    queryFn: () =>
      apiFetch<GlobalSearchResponse>(
        `/global-search?${new URLSearchParams({ q: term }).toString()}`,
      ),
    enabled: term.length >= GLOBAL_SEARCH_MIN_CHARS,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
