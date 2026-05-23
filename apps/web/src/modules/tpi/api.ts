import type { TpiResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const tpiKeys = {
  all: ['tpi'] as const,
};

export function useTpi() {
  return useQuery<TpiResponse>({
    queryKey: tpiKeys.all,
    queryFn: () => apiFetch<TpiResponse>('/tpi'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}
