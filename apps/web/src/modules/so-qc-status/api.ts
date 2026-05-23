import type { ListSoForQcResponse, SoQcStatusResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soQcStatusKeys = {
  all: ['so-qc-status'] as const,
  list: () => [...soQcStatusKeys.all, 'list'] as const,
  detail: (soId: string) => [...soQcStatusKeys.all, 'detail', soId] as const,
};

export function useSoForQc() {
  return useQuery<ListSoForQcResponse>({
    queryKey: soQcStatusKeys.list(),
    queryFn: () => apiFetch<ListSoForQcResponse>('/so-qc-status'),
    placeholderData: (prev) => prev,
  });
}

export function useSoQcStatus(soId: string | undefined) {
  return useQuery<SoQcStatusResponse>({
    queryKey: soId ? soQcStatusKeys.detail(soId) : soQcStatusKeys.detail('__none__'),
    queryFn: () => apiFetch<SoQcStatusResponse>(`/so-qc-status/${soId}`),
    enabled: Boolean(soId),
    placeholderData: (prev) => prev,
  });
}
