import type {
  DashChecksResponse,
  HomeResponse,
  HomeScope,
  MarkAllNotificationsReadInput,
  MarkNotificationsReadInput,
  NotificationFilter,
  NotificationsResponse,
} from '@innovic/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';

// ADR-264 — `checks` is nested UNDER `home()`, so every live mapping and every
// mutation that refreshes the home (lib/live-updates/table-keys.ts, tasks,
// day-logs, party-grn, qc-documents, cancel-requests) refreshes the department
// checks too (they only run on the home page). Notifications are NOT under it:
// the bell is on every page, so they have their own root (notificationKeys).
export const dashboardKeys = {
  all: ['dashboard'] as const,
  kpis: () => [...dashboardKeys.all, 'kpis'] as const,
  /** Home and checks — what live updates and saves refetch. */
  home: () => [...dashboardKeys.all, 'home'] as const,
  homeScope: (scope: HomeScope) => [...dashboardKeys.home(), scope] as const,
  /** ADR-264 department checks (GET /dashboard/checks). */
  checks: () => [...dashboardKeys.home(), 'checks'] as const,
  widgets: () => [...dashboardKeys.all, 'widgets'] as const,
  config: () => [...dashboardKeys.all, 'config'] as const,
};

/** ADR-264 — the bell (on every page) and All notifications. Its own root, so
 *  a home refresh from any module or live event does not re-run this read;
 *  it polls (LIVE_FALLBACK_POLL_MS) and refetches on window focus. */
export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filter: NotificationFilter, limit: number) =>
    [...notificationKeys.all, filter, limit] as const,
};

/** ADR-250 / ADR-264 — the home payload. The ADR-264 home reads only to-do,
 *  done and approvals, so every request asks for the lite build (`lite=true`);
 *  the other blocks come back empty. useHome has no other caller. */
export function useHome(scope: HomeScope = 'dept') {
  return useQuery<HomeResponse>({
    queryKey: dashboardKeys.homeScope(scope),
    queryFn: () => apiFetch<HomeResponse>(`/dashboard/home?scope=${scope}&lite=true`),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** ADR-264 — the caller's departments and their checks. The server already
 *  leaves out departments and checks the caller may not see. */
export function useDashChecks() {
  return useQuery<DashChecksResponse>({
    queryKey: dashboardKeys.checks(),
    queryFn: () => apiFetch<DashChecksResponse>('/dashboard/checks'),
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** ADR-264 — notifications for the bell (limit 6) and the full page (200). */
export function useNotifications(filter: NotificationFilter, limit: number, enabled = true) {
  return useQuery<NotificationsResponse>({
    queryKey: notificationKeys.list(filter, limit),
    queryFn: () =>
      apiFetch<NotificationsResponse>(`/dashboard/notifications?filter=${filter}&limit=${limit}`),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** Mark events read / unread; every notifications read refetches. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, MarkNotificationsReadInput>({
    mutationFn: (input) =>
      apiFetch('/dashboard/notifications/read', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** "Mark all as read" — everything up to the newest event shown. */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, MarkAllNotificationsReadInput>({
    mutationFn: (input) =>
      apiFetch('/dashboard/notifications/read-all', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
