import type {
  ApprovalConfig,
  ApprovalHistoryResponse,
  SaveApprovalConfigInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const approvalConfigKeys = {
  all: ['approval-config'] as const,
  config: () => [...approvalConfigKeys.all, 'config'] as const,
  history: () => [...approvalConfigKeys.all, 'history'] as const,
};

export function useApprovalConfig() {
  return useQuery<ApprovalConfig>({
    queryKey: approvalConfigKeys.config(),
    queryFn: () => apiFetch<ApprovalConfig>('/approval-config'),
  });
}

export function useApprovalHistory() {
  return useQuery<ApprovalHistoryResponse>({
    queryKey: approvalConfigKeys.history(),
    queryFn: () => apiFetch<ApprovalHistoryResponse>('/approval-config/history'),
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
