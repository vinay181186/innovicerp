import type {
  DashboardConfig,
  DashboardConfigScreen,
  DashboardKpisResponse,
  HomeResponse,
  HomeScope,
  ListWidgetsResponse,
  MarkNotificationsSeenInput,
  SaveDashboardConfigInput,
} from '@innovic/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  kpis: () => [...dashboardKeys.all, 'kpis'] as const,
  /** Both scopes — what live updates and the seen-mark refetch. */
  home: () => [...dashboardKeys.all, 'home'] as const,
  homeScope: (scope: HomeScope) => [...dashboardKeys.home(), scope] as const,
  widgets: () => [...dashboardKeys.all, 'widgets'] as const,
  config: () => [...dashboardKeys.all, 'config'] as const,
};

/** ADR-250 — the home for `scope` (My department / Mine). The server filters
 *  rows and counts for the scope; the browser never does. */
export function useHome(scope: HomeScope) {
  return useQuery<HomeResponse>({
    queryKey: dashboardKeys.homeScope(scope),
    queryFn: () => apiFetch<HomeResponse>(`/dashboard/home?scope=${scope}`),
    // Switching scope keeps the page on screen until the other scope arrives.
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** ADR-250 — move the caller's "seen" time for home notifications forward
 *  (the server keeps the later of stored and sent), then refetch home so the
 *  bell count drops. */
export function useMarkNotificationsSeen() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, MarkNotificationsSeenInput>({
    mutationFn: (input) =>
      apiFetch('/dashboard/notifications/seen', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardKeys.home() }),
  });
}

export function useWidgets() {
  return useQuery<ListWidgetsResponse>({
    queryKey: dashboardKeys.widgets(),
    queryFn: () => apiFetch<ListWidgetsResponse>('/dashboard/widgets'),
    staleTime: 30_000,
  });
}

export function useDashboardConfigScreen() {
  return useQuery<DashboardConfigScreen>({
    queryKey: dashboardKeys.config(),
    queryFn: () => apiFetch<DashboardConfigScreen>('/dashboard/config'),
  });
}

export function useSaveDashboardConfig() {
  const qc = useQueryClient();
  return useMutation<DashboardConfig, Error, SaveDashboardConfigInput>({
    mutationFn: (input) =>
      apiFetch<DashboardConfig>('/dashboard/config', { method: 'PUT', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dashboardKeys.all }),
  });
}

export function useDashboardKpis() {
  return useQuery<DashboardKpisResponse>({
    queryKey: dashboardKeys.kpis(),
    queryFn: () => apiFetch<DashboardKpisResponse>('/dashboard/kpis'),
    // Refresh on focus + every 60s — KPIs are aggregate counts, no point
    // hammering the DB; users will trigger a refresh on tab focus anyway.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
