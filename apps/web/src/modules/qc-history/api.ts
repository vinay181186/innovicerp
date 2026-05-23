import type { QcHistoryResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcHistoryKeys = {
  all: ['qc-history'] as const,
};

export function useQcHistory() {
  return useQuery<QcHistoryResponse>({
    queryKey: qcHistoryKeys.all,
    queryFn: () => apiFetch<QcHistoryResponse>('/qc-history'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}
