import type {
  AlertConfigEntry,
  AlertSubscriptionEntry,
  ListAlertConfigResponse,
  ListAlertSubscriptionsResponse,
  ListAlertsPageResponse,
  ListAlertsResponse,
  RunAlertResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const alertsKeys = {
  all: ['alerts'] as const,
  list: () => [...alertsKeys.all, 'list'] as const,
  page: (q: AlertsPageParams) => [...alertsKeys.list(), 'page', q] as const,
  drill: (code: string) => [...alertsKeys.all, 'drill', code] as const,
  drillPage: (code: string, limit: number, offset: number) =>
    [...alertsKeys.drill(code), limit, offset] as const,
  config: () => [...alertsKeys.all, 'config'] as const,
  subscriptions: () => [...alertsKeys.all, 'subscriptions'] as const,
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

/** The dashboard's server-side search / "show zero" filter + page (ADR-201). */
export interface AlertsPageParams {
  search: string | undefined;
  showZero: boolean;
  limit: number;
  offset: number;
}

export function useAlertsPage(q: AlertsPageParams) {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('showZero', q.showZero ? 'true' : 'false');
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return useQuery<ListAlertsPageResponse>({
    queryKey: alertsKeys.page(q),
    queryFn: () => apiFetch<ListAlertsPageResponse>(`/alerts?${params.toString()}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

/** One alert's drill records — one page (`alert.count` = every record). */
export function useAlert(code: string | undefined, limit: number, offset: number) {
  return useQuery<RunAlertResponse>({
    queryKey: code ? alertsKeys.drillPage(code, limit, offset) : alertsKeys.drill('__missing__'),
    queryFn: () => apiFetch<RunAlertResponse>(`/alerts/${code}?limit=${limit}&offset=${offset}`),
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

export function useMySubscriptions() {
  return useQuery<ListAlertSubscriptionsResponse>({
    queryKey: alertsKeys.subscriptions(),
    queryFn: () => apiFetch<ListAlertSubscriptionsResponse>('/alerts/subscriptions'),
  });
}

export function useToggleSubscription() {
  const qc = useQueryClient();
  return useMutation<AlertSubscriptionEntry | null, Error, { code: string; subscribed: boolean }>({
    mutationFn: ({ code, subscribed }) =>
      apiFetch<AlertSubscriptionEntry | null>(`/alerts/subscriptions/${code}`, {
        method: 'PUT',
        json: { subscribed },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertsKeys.subscriptions() });
    },
  });
}
