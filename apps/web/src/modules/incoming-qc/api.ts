import type { IncomingQcResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const incomingQcKeys = {
  all: ['incoming-qc'] as const,
};

export function useIncomingQc() {
  return useQuery<IncomingQcResponse>({
    queryKey: incomingQcKeys.all,
    queryFn: () => apiFetch<IncomingQcResponse>('/incoming-qc'),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
