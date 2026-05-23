import type {
  CreatePartyMaterialInput,
  ListPartyMaterialsQuery,
  ListPartyMaterialsResponse,
  PartyMaterial,
  UpdatePartyMaterialInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const partyMaterialsKeys = {
  all: ['party-materials'] as const,
  list: (q: ListPartyMaterialsQuery) =>
    [
      ...partyMaterialsKeys.all,
      'list',
      q.search ?? null,
      q.clientId ?? null,
      q.limit,
      q.offset,
    ] as const,
  nextCode: () => [...partyMaterialsKeys.all, 'next-code'] as const,
};

function buildSearch(q: ListPartyMaterialsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.clientId) params.set('clientId', q.clientId);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePartyMaterialsList(query: ListPartyMaterialsQuery) {
  return useQuery<ListPartyMaterialsResponse>({
    queryKey: partyMaterialsKeys.list(query),
    queryFn: () =>
      apiFetch<ListPartyMaterialsResponse>(`/party-materials?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useNextPartyMaterialCode() {
  return useQuery<{ code: string }>({
    queryKey: partyMaterialsKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/party-materials/next-code'),
    staleTime: 0,
  });
}

export function useCreatePartyMaterial() {
  const qc = useQueryClient();
  return useMutation<PartyMaterial, Error, CreatePartyMaterialInput>({
    mutationFn: (input) =>
      apiFetch<PartyMaterial>('/party-materials', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialsKeys.all });
    },
  });
}

export function useUpdatePartyMaterial() {
  const qc = useQueryClient();
  return useMutation<PartyMaterial, Error, { id: string; input: UpdatePartyMaterialInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<PartyMaterial>(`/party-materials/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialsKeys.all });
    },
  });
}

export function useDeletePartyMaterial() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/party-materials/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialsKeys.all });
    },
  });
}
