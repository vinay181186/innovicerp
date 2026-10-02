// Approvals inbox (ADR-190) — GET /approvals/inbox: what is waiting for the
// signed-in user to approve, as three lists (PR, PO, Log Entry) with counts.
// The server applies each approve endpoint's own rules, so every row listed is
// one the caller may actually approve.

import type {
  ApprovalInboxListQuery,
  ApprovalInboxListResponse,
  ApprovalInboxResponse,
  ListOpLogTimeChangePageQuery,
  ListOpLogTimeChangePageResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { opEntryKeys } from '@/modules/op-entry/api';

export const approvalsKeys = {
  all: ['approvals'] as const,
  inbox: () => [...approvalsKeys.all, 'inbox'] as const,
  // Under inbox(), so every invalidation of the inbox refreshes the pages too.
  inboxList: (q: ApprovalInboxListQuery) => [...approvalsKeys.inbox(), 'list', q] as const,
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

/** Op Entry approvals, one 25-row page (ADR-201). Keyed under op-entry's
 *  'time-changes' so an Approve / Reject refreshes it with the other lists. */
export function useOpLogTimeChangePage(q: ListOpLogTimeChangePageQuery) {
  return useQuery<ListOpLogTimeChangePageResponse>({
    queryKey: [...opEntryKeys.all, 'time-changes', 'page', q] as const,
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.status) p.set('status', q.status);
      if (q.search) p.set('search', q.search);
      if (q.sf) p.set('sf', q.sf);
      p.set('limit', String(q.limit));
      p.set('offset', String(q.offset));
      return apiFetch<ListOpLogTimeChangePageResponse>(
        `/op-entry/time-changes/page?${p.toString()}`,
      );
    },
    placeholderData: (prev) => prev,
  });
}

/** One PR / PO section, a page at a time — search + Sort & Filter on the
 *  server over every waiting document (ADR-201). */
export function useApprovalInboxList(query: ApprovalInboxListQuery) {
  return useQuery<ApprovalInboxListResponse>({
    queryKey: approvalsKeys.inboxList(query),
    queryFn: () => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') p.set(k, String(v));
      }
      return apiFetch<ApprovalInboxListResponse>(`/approvals/inbox/list?${p.toString()}`);
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    refetchOnMount: 'always',
  });
}
