// SO Costing list fetch — one page of GET /so-costing. The list's query and the
// shared Export (ADR-310) both build the URL here, so they send the same one.

import type { ListSoCostingResponse } from '@innovic/shared';
import { apiFetch } from '@/lib/api';

export interface SoCostingPageQuery {
  search?: string | undefined;
  sf?: string | undefined;
  limit: number;
  offset: number;
}

/** The query string the list sends (also its cache key). */
export function soCostingQueryString(q: SoCostingPageQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function fetchSoCostingPage(q: SoCostingPageQuery): Promise<ListSoCostingResponse> {
  return apiFetch<ListSoCostingResponse>(`/so-costing?${soCostingQueryString(q)}`);
}
