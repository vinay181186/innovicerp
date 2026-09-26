// Approvals inbox (ADR-190) — GET /approvals/inbox: what is waiting for the
// signed-in user to approve, as three lists (PR, PO, Log Entry) with counts.
// The server applies each approve endpoint's own rules, so every row listed is
// one the caller may actually approve.

import type { ApprovalInboxResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const approvalsKeys = {
  all: ['approvals'] as const,
  inbox: () => [...approvalsKeys.all, 'inbox'] as const,
};

export function useApprovalInbox(opts: { enabled?: boolean; refetchOnMount?: 'always' } = {}) {
  return useQuery<ApprovalInboxResponse>({
    queryKey: approvalsKeys.inbox(),
    queryFn: () => apiFetch<ApprovalInboxResponse>('/approvals/inbox'),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
    ...(opts.refetchOnMount ? { refetchOnMount: opts.refetchOnMount } : {}),
  });
}

/** Everything waiting for the caller (PR + PO + Log Entry) — the nav badge. */
export function useApprovalInboxTotal(enabled: boolean): number {
  const q = useApprovalInbox({ enabled });
  const c = q.data?.counts;
  return c ? c.pr + c.po + c.logEntry : 0;
}
