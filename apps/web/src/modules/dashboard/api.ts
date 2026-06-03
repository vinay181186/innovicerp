import type {
  DashboardConfig,
  DashboardConfigScreen,
  DashboardKpisResponse,
  HomeResponse,
  ListWidgetsResponse,
  SaveDashboardConfigInput,
  WorkListItem,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  kpis: () => [...dashboardKeys.all, 'kpis'] as const,
  home: () => [...dashboardKeys.all, 'home'] as const,
  workList: () => [...dashboardKeys.all, 'work-list'] as const,
  widgets: () => [...dashboardKeys.all, 'widgets'] as const,
  config: () => [...dashboardKeys.all, 'config'] as const,
};

export function useHome() {
  return useQuery<HomeResponse>({
    queryKey: dashboardKeys.home(),
    queryFn: () => apiFetch<HomeResponse>('/dashboard/home'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useWorkList() {
  return useQuery<{ items: WorkListItem[] }>({
    queryKey: dashboardKeys.workList(),
    queryFn: () => apiFetch<{ items: WorkListItem[] }>('/dashboard/work-list'),
    staleTime: 30_000,
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
    mutationFn: (input) => apiFetch<DashboardConfig>('/dashboard/config', { method: 'PUT', json: input }),
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
