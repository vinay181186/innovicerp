import type {
  AssemblyListResponse,
  AssemblyTrackerResponse,
  AssemblyUnitRow,
  MarkUnitAssembledInput,
  MarkUnitDispatchedInput,
  SetReadinessOverrideInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const assemblyKeys = {
  all: ['assemblies'] as const,
  list: () => [...assemblyKeys.all, 'list'] as const,
  detail: (soId: string) => [...assemblyKeys.all, 'detail', soId] as const,
};

export function useAssembliesList() {
  return useQuery<AssemblyListResponse>({
    queryKey: assemblyKeys.list(),
    queryFn: () => apiFetch<AssemblyListResponse>('/assemblies'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAssemblyTracker(soId: string) {
  return useQuery<AssemblyTrackerResponse>({
    queryKey: assemblyKeys.detail(soId),
    queryFn: () => apiFetch<AssemblyTrackerResponse>(`/assemblies/${soId}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkUnitAssembled(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkUnitAssembledInput) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/${soId}/units`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useMarkUnitDispatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, input }: { unitId: string; input: MarkUnitDispatchedInput }) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/units/${unitId}/dispatch`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useUndoLastUnit(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; removedUnitNo: number }>(`/assemblies/${soId}/units/last`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useSetReadinessOverride(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ childCode, input }: { childCode: string; input: SetReadinessOverrideInput }) =>
      apiFetch<{ ok: true }>(`/assemblies/${soId}/overrides/${encodeURIComponent(childCode)}`, {
        method: 'PUT',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}
