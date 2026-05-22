import type { PendingSoValueFilter, PendingSoValueResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const pendingSoValueKeys = {
  all: ['pending-so-value'] as const,
  list: (filter: PendingSoValueFilter) => [...pendingSoValueKeys.all, filter] as const,
};

export function usePendingSoValue(filter: PendingSoValueFilter) {
  return useQuery<PendingSoValueResponse>({
    queryKey: pendingSoValueKeys.list(filter),
    queryFn: () => apiFetch<PendingSoValueResponse>(`/pending-so-value?filter=${filter}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
