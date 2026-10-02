// Stock Valuation data (ADR-201): the item-type / zero-stock filters, the
// search, Sort & Filter and the 25-row page all run on the server; the tiles
// and the totals row come back worked out over every item / every match.

import type { StockValuationResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fetchAllPages } from '@/lib/list-paging';

export interface StockValuationParams {
  category: string | undefined;
  showZero: boolean;
  search: string | undefined;
  sf: string | undefined;
}

function url(p: StockValuationParams, limit: number, offset: number): string {
  const q = new URLSearchParams();
  if (p.category) q.set('category', p.category);
  q.set('showZero', p.showZero ? 'true' : 'false');
  if (p.search) q.set('search', p.search);
  if (p.sf) q.set('sf', p.sf);
  q.set('limit', String(limit));
  q.set('offset', String(offset));
  return `/stock-valuation?${q.toString()}`;
}

export function useStockValuation(p: StockValuationParams, limit: number, offset: number) {
  return useQuery<StockValuationResponse>({
    queryKey: ['stock-valuation', p, limit, offset],
    queryFn: () => apiFetch<StockValuationResponse>(url(p, limit, offset)),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Every row matching the screen's filters — for the Excel export. */
export function fetchAllStockValuation(p: StockValuationParams) {
  return fetchAllPages(async (limit, offset) => {
    const res = await apiFetch<StockValuationResponse>(url(p, limit, offset));
    return { items: res.rows, total: res.total };
  });
}
