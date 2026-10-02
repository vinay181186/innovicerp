import type {
  CapaRecord,
  CreateCapaInput,
  ListCapaQuery,
  ListCapaResponse,
  UpdateCapaInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const capaKeys = {
  all: ['capa'] as const,
  list: (q: ListCapaQuery = {}) => [...capaKeys.all, 'list', q] as const,
  nextCode: () => [...capaKeys.all, 'next-code'] as const,
};

export function useNextCapaCode() {
  return useQuery<{ code: string }>({
    queryKey: capaKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/capa/next-code'),
    staleTime: 0,
  });
}

/** No args → every CAPA (New CAPA modal); the list screen passes a 25-row page. */
export function useCapaList(q: ListCapaQuery = {}) {
  return useQuery<ListCapaResponse>({
    queryKey: capaKeys.list(q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.search) params.set('search', q.search);
      if (q.sf) params.set('sf', q.sf);
      if (q.limit !== undefined) params.set('limit', String(q.limit));
      if (q.offset) params.set('offset', String(q.offset));
      const qs = params.toString();
      return apiFetch<ListCapaResponse>(qs ? `/capa?${qs}` : '/capa');
    },
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
