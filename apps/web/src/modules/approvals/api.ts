// Approvals (ADR-265) — ONE list of everything waiting for the signed-in
// user's decision (GET /approvals/waiting) and the history of past decisions
// (GET /approvals/history). The home Approvals view, Settings → Approvals and
// the top-menu badge all read the SAME `waiting()` query, so they always show
// the same number. The server applies each decide endpoint's own rules, so
// every row listed is one the caller may actually decide.

import type {
  ApprovalHistoryListQuery,
  ApprovalHistoryListResponse,
  WaitingApprovalsResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';

export const approvalsKeys = {
  all: ['approvals'] as const,
  /** ADR-265 — everything waiting for the caller (one query app-wide). */
  waiting: () => [...approvalsKeys.all, 'waiting'] as const,
  /** ADR-265 — past decisions, one page per query. */
  history: (q: ApprovalHistoryListQuery) => [...approvalsKeys.all, 'history', q] as const,
};

/** Everything waiting for the caller — the home Approvals view, the Approvals
 *  page and the top-menu badge (one query, so one number). */
export function useWaitingApprovals(opts: { enabled?: boolean } = {}) {
  return useQuery<WaitingApprovalsResponse>({
    queryKey: approvalsKeys.waiting(),
    queryFn: () => apiFetch<WaitingApprovalsResponse>('/approvals/waiting'),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    // ADR-230 safety refresh behind the live updates.
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}

/** Past decisions (Approved / Rejected), one 25-row page from the server. */
export function useApprovalHistory(q: ApprovalHistoryListQuery) {
  return useQuery<ApprovalHistoryListResponse>({
    queryKey: approvalsKeys.history(q),
    queryFn: () => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) {
        if (v !== undefined && v !== '') p.set(k, String(v));
      }
      return apiFetch<ApprovalHistoryListResponse>(`/approvals/history?${p.toString()}`);
    },
    placeholderData: (prev) => prev,
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}
