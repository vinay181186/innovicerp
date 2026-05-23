import type { MachineLoadingResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const machineLoadingKeys = {
  all: ['machine-loading'] as const,
};

export function useMachineLoading() {
  return useQuery<MachineLoadingResponse>({
    queryKey: machineLoadingKeys.all,
    queryFn: () => apiFetch<MachineLoadingResponse>('/machine-loading'),
    // Live-ish: ops availability shifts as the floor logs work.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
