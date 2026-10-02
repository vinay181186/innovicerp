import type {
  ApprovalConfig,
  ApprovalHistoryQuery,
  ApprovalHistoryResponse,
  SaveApprovalConfigInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const approvalConfigKeys = {
  all: ['approval-config'] as const,
  config: () => [...approvalConfigKeys.all, 'config'] as const,
  history: () => [...approvalConfigKeys.all, 'history'] as const,
  historyPage: (q: ApprovalHistoryQuery) => [...approvalConfigKeys.history(), q] as const,
};

export function useApprovalConfig() {
  return useQuery<ApprovalConfig>({
    queryKey: approvalConfigKeys.config(),
    queryFn: () => apiFetch<ApprovalConfig>('/approval-config'),
  });
}

/** One page of approval activity (ADR-201): search + Sort & Filter on the server. */
export function useApprovalHistory(q: ApprovalHistoryQuery) {
  return useQuery<ApprovalHistoryResponse>({
    queryKey: approvalConfigKeys.historyPage(q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.search) params.set('search', q.search);
      if (q.sf) params.set('sf', q.sf);
      params.set('limit', String(q.limit));
      params.set('offset', String(q.offset));
      return apiFetch<ApprovalHistoryResponse>(`/approval-config/history?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useSaveApprovalConfig() {
  const qc = useQueryClient();
  return useMutation<ApprovalConfig, Error, SaveApprovalConfigInput>({
    mutationFn: (input) =>
      apiFetch<ApprovalConfig>('/approval-config', { method: 'PUT', json: input }),
    onSuccess: (saved) => {
      qc.setQueryData(approvalConfigKeys.config(), saved);
      void qc.invalidateQueries({ queryKey: approvalConfigKeys.history() });
    },
  });
}
