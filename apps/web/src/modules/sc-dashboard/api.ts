// Supply Chain Dashboard data (ADR-201). GET /sc-dashboard = KPI strip +
// Pending PO Tracker picklists; each of the five tables pages at 25 rows on
// its own endpoint, with its own page (component state) and Sort & Filter
// (server mode). Totals come from the server over every matching row.

import type { ScDashboardResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { type ServerSortFilter, useServerSortFilter } from '@/ui/data/sort-filter/server-state';

export function useScDashboard() {
  return useQuery<ScDashboardResponse>({
    queryKey: ['sc-dashboard'],
    queryFn: () => apiFetch<ScDashboardResponse>('/sc-dashboard'),
    staleTime: 30_000,
  });
}

function qs(params: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

export interface ScTable<R> {
  data: R | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  page: number;
  onPage: (p: number) => void;
  sf: ServerSortFilter;
}

/**
 * One paged dashboard table. `filters` are extra query params (the Pending PO
 * Tracker's Vendor / Item / SO boxes); the caller resets to page 1 when they
 * change via the returned `onPage(1)`.
 */
export function useScTable<R extends { total: number }>(
  path: string,
  sfKey: string,
  filters: Record<string, string | undefined> = {},
): ScTable<R> {
  const [page, setPage] = useState(1);
  const onPage = useCallback((p: number) => setPage(p), []);
  const sf = useServerSortFilter(sfKey, () => setPage(1));
  const query = qs({ ...filters, sf: sf.param, limit: LIST_PAGE_SIZE, offset: pageOffset(page) });
  const q = useQuery<R>({
    queryKey: ['sc-dashboard', path, query],
    queryFn: () => apiFetch<R>(`/sc-dashboard/${path}?${query}`),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  useClampPage(page, q.data?.total, onPage);
  return {
    data: q.data,
    isLoading: q.isLoading,
    isFetching: q.isFetching,
    isError: q.isError,
    error: q.error,
    page,
    onPage,
    sf,
  };
}
