import type {
  AlertConfigEntry,
  ListAlertConfigResponse,
  ListAlertsResponse,
  RunAlertResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const alertsKeys = {
  all: ['alerts'] as const,
  list: () => [...alertsKeys.all, 'list'] as const,
  drill: (code: string) => [...alertsKeys.all, 'drill', code] as const,
  config: () => [...alertsKeys.all, 'config'] as const,
};

export function useAlerts() {
  return useQuery<ListAlertsResponse>({
    queryKey: alertsKeys.list(),
    queryFn: () => apiFetch<ListAlertsResponse>('/alerts'),
    // Polling cadence per ADR-004 (alerts is on the polling side, not Realtime).
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAlert(code: string | undefined) {
  return useQuery<RunAlertResponse>({
    queryKey: code ? alertsKeys.drill(code) : alertsKeys.drill('__missing__'),
    queryFn: () => apiFetch<RunAlertResponse>(`/alerts/${code}`),
    enabled: Boolean(code),
    placeholderData: (prev) => prev,
  });
}

export function useAlertConfig() {
  return useQuery<ListAlertConfigResponse>({
    queryKey: alertsKeys.config(),
    queryFn: () => apiFetch<ListAlertConfigResponse>('/alerts/config'),
  });
}

export function useToggleAlert() {
  const qc = useQueryClient();
  return useMutation<AlertConfigEntry, Error, { code: string; active: boolean }>({
    mutationFn: ({ code, active }) =>
      apiFetch<AlertConfigEntry>(`/alerts/config/${code}`, {
        method: 'PUT',
        json: { active },
      }),
    onSuccess: () => {
      // Invalidate both config (admin page) and list (user dashboard).
      void qc.invalidateQueries({ queryKey: alertsKeys.all });
    },
  });
}
