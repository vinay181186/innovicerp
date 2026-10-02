import type {
  ListQcLogsQuery,
  ListQcPendingQuery,
  QcHistoryResponse,
  QcHistoryStats,
  QcLogsListResponse,
  QcPendingListResponse,
  QcRegisterQuery,
  QcRegisterResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// Every key starts with 'qc-history', so invalidating `qcHistoryKeys.all`
// (after a QC / TPI submit) refreshes the paged lists, the KPIs and the register.
export const qcHistoryKeys = {
  all: ['qc-history'] as const,
  pending: (q: ListQcPendingQuery) => ['qc-history', 'pending', q] as const,
  logs: (q: ListQcLogsQuery) => ['qc-history', 'logs', q] as const,
  stats: ['qc-history', 'stats'] as const,
  register: (q: QcRegisterQuery) => ['qc-history', 'register', q] as const,
};

/** Query string from a params object (undefined / '' dropped). */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** The whole feed (older callers). */
export function useQcHistory() {
  return useQuery<QcHistoryResponse>({
    queryKey: qcHistoryKeys.all,
    queryFn: () => apiFetch<QcHistoryResponse>('/qc-history'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function fetchQcPending(q: ListQcPendingQuery): Promise<QcPendingListResponse> {
  return apiFetch<QcPendingListResponse>(`/qc-history/pending${qs(q)}`);
}
export function fetchQcLogs(q: ListQcLogsQuery): Promise<QcLogsListResponse> {
  return apiFetch<QcLogsListResponse>(`/qc-history/logs${qs(q)}`);
}
export function fetchQcRegister(q: QcRegisterQuery): Promise<QcRegisterResponse> {
  return apiFetch<QcRegisterResponse>(`/qc-history/register${qs(q)}`);
}

/** QC Pending ops — one page (ADR-201). */
export function useQcPendingList(q: ListQcPendingQuery) {
  return useQuery<QcPendingListResponse>({
    queryKey: qcHistoryKeys.pending(q),
    queryFn: () => fetchQcPending(q),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** Completed QC entries — one page (ADR-201). */
export function useQcLogsList(q: ListQcLogsQuery) {
  return useQuery<QcLogsListResponse>({
    queryKey: qcHistoryKeys.logs(q),
    queryFn: () => fetchQcLogs(q),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

/** KPI figures over every row. */
export function useQcHistoryStats() {
  return useQuery<QcHistoryStats>({
    queryKey: qcHistoryKeys.stats,
    queryFn: () => apiFetch<QcHistoryStats>('/qc-history/stats'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

/**
 * QC Call Register — one page of incoming + process calls (ADR-201).
 * `keepPrevious` false for a one-row lookup (the Inspect popup), so another
 * call's row never stands in while the new one loads.
 */
export function useQcRegister(q: QcRegisterQuery, enabled = true, keepPrevious = true) {
  return useQuery<QcRegisterResponse>({
    queryKey: qcHistoryKeys.register(q),
    queryFn: () => fetchQcRegister(q),
    refetchInterval: 60_000,
    ...(keepPrevious ? { placeholderData: (prev: QcRegisterResponse | undefined) => prev } : {}),
    enabled,
  });
}
