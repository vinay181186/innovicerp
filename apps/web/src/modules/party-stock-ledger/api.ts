// Party Stock Ledger (R3, ADR-194) — append-only movements of customer-owned
// material in the separate, zero-value party store. Read-only register.

import type { ListPartyStockLedgerQuery, ListPartyStockLedgerResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const partyStockLedgerKeys = {
  all: ['party-stock-ledger'] as const,
  list: (q: ListPartyStockLedgerQuery) =>
    [
      ...partyStockLedgerKeys.all,
      'list',
      q.partyMaterialId ?? null,
      q.jwLineId ?? null,
      q.movement ?? null,
      q.search ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildSearch(q: ListPartyStockLedgerQuery): string {
  const params = new URLSearchParams();
  if (q.partyMaterialId) params.set('partyMaterialId', q.partyMaterialId);
  if (q.jwLineId) params.set('jwLineId', q.jwLineId);
  if (q.movement) params.set('movement', q.movement);
  if (q.search) params.set('search', q.search);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

/** One page of the Customer Material Stock Ledger — the list's query and the
 *  shared Export (ADR-310) both call this, so they send the same URL. */
export function fetchPartyStockLedgerPage(
  query: ListPartyStockLedgerQuery,
): Promise<ListPartyStockLedgerResponse> {
  return apiFetch<ListPartyStockLedgerResponse>(`/party-stock-ledger?${buildSearch(query)}`);
}

export function usePartyStockLedgerList(query: ListPartyStockLedgerQuery) {
  return useQuery<ListPartyStockLedgerResponse>({
    queryKey: partyStockLedgerKeys.list(query),
    queryFn: () => fetchPartyStockLedgerPage(query),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
