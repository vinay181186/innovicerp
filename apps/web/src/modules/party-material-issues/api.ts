import type {
  CreatePartyMaterialIssueInput,
  ListPartyMaterialIssuesResponse,
  PartyMaterialIssue,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const partyMaterialIssuesKeys = {
  all: ['party-material-issues'] as const,
  list: () => [...partyMaterialIssuesKeys.all, 'list'] as const,
};

export function usePartyMaterialIssuesList() {
  return useQuery<ListPartyMaterialIssuesResponse>({
    queryKey: partyMaterialIssuesKeys.list(),
    queryFn: () => apiFetch<ListPartyMaterialIssuesResponse>('/party-material-issues'),
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
    },
  });
}
