import type {
  CreatePartyMaterialIssueInput,
  ListPartyMaterialIssuesQuery,
  ListPartyMaterialIssuesResponse,
  PartyMaterialIssue,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const partyMaterialIssuesKeys = {
  all: ['party-material-issues'] as const,
  lists: () => [...partyMaterialIssuesKeys.all, 'list'] as const,
  // The query is part of the key, so a new search term is a new cache entry
  // and a new fetch — the whole point of moving the match to the server.
  list: (q: ListPartyMaterialIssuesQuery) =>
    [...partyMaterialIssuesKeys.lists(), q] as const,
};

/** The register's filters, as a query string. `search` is dropped when empty so
 *  an untouched box is not sent as `search=` — the server treats "absent" and
 *  "empty" alike, but leaving it out keeps the URL and the cache key clean. */
function toQueryString(q: ListPartyMaterialIssuesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePartyMaterialIssuesList(query: ListPartyMaterialIssuesQuery) {
  return useQuery<ListPartyMaterialIssuesResponse>({
    queryKey: partyMaterialIssuesKeys.list(query),
    queryFn: () =>
      apiFetch<ListPartyMaterialIssuesResponse>(
        `/party-material-issues?${toQueryString(query)}`,
      ),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreatePartyMaterialIssue() {
  const qc = useQueryClient();
  return useMutation<PartyMaterialIssue, Error, CreatePartyMaterialIssueInput>({
    mutationFn: (input) =>
      apiFetch<PartyMaterialIssue>('/party-material-issues', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialIssuesKeys.all });
      // Party material stocks changed
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      // ADR-103: the issued qty is now what unlocks production, so the JC
      // status (RM AVAIL tile) and the op board must both refresh.
      void qc.invalidateQueries({ queryKey: ['job-cards'] });
      void qc.invalidateQueries({ queryKey: ['jc-ops'] });
    },
  });
}

/** ADR-103 — reverse a wrong issue. Refused once the material has been
 *  machined; the server explains which job card and how many pieces. */
export function useCancelPartyMaterialIssue() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; code: string; reversedQty: number },
    Error,
    { id: string; reason: string }
  >({
    mutationFn: ({ id, reason }) =>
      apiFetch<{ ok: true; code: string; reversedQty: number }>(
        `/party-material-issues/${id}/cancel`,
        { method: 'POST', json: { reason } },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialIssuesKeys.all });
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      void qc.invalidateQueries({ queryKey: ['job-cards'] });
      void qc.invalidateQueries({ queryKey: ['jc-ops'] });
    },
  });
}
