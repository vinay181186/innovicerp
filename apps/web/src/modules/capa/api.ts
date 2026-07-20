import type {
  CapaRecord,
  CreateCapaInput,
  ListCapaResponse,
  UpdateCapaInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const capaKeys = {
  all: ['capa'] as const,
  list: () => [...capaKeys.all, 'list'] as const,
  nextCode: () => [...capaKeys.all, 'next-code'] as const,
};

export function useNextCapaCode() {
  return useQuery<{ code: string }>({
    queryKey: capaKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/capa/next-code'),
    staleTime: 0,
  });
}

export function useCapaList() {
  return useQuery<ListCapaResponse>({
    queryKey: capaKeys.list(),
    queryFn: () => apiFetch<ListCapaResponse>('/capa'),
    placeholderData: (prev) => prev,
  });
}

export function useCreateCapa() {
  const qc = useQueryClient();
  return useMutation<CapaRecord, Error, CreateCapaInput>({
    mutationFn: (input) => apiFetch<CapaRecord>('/capa', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: capaKeys.all }),
  });
}

export function useUpdateCapa() {
  const qc = useQueryClient();
  return useMutation<CapaRecord, Error, { id: string; input: UpdateCapaInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<CapaRecord>(`/capa/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: capaKeys.all }),
  });
}
