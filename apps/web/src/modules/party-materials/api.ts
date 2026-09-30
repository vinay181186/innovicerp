import type {
  CreatePartyMaterialInput,
  ListPartyMaterialsQuery,
  ListPartyMaterialsResponse,
  PartyMaterial,
  ReturnPartyMaterialInput,
  UpdatePartyMaterialInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';

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

export function usePartyMaterialsList(
  query: ListPartyMaterialsQuery,
  options?: { enabled?: boolean },
) {
  return useQuery<ListPartyMaterialsResponse>({
    queryKey: partyMaterialsKeys.list(query),
    queryFn: () => apiFetch<ListPartyMaterialsResponse>(`/party-materials?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    ...(options?.enabled === undefined ? {} : { enabled: options.enabled }),
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
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
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
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

/** R7 (ADR-194): return spare customer material to the customer. Caps at the
 *  current party-store balance; posts a 'return' (out) row to the party stock
 *  ledger and bumps returnedQty. Reuses jw_create. */
export function useReturnPartyMaterial() {
  const qc = useQueryClient();
  return useMutation<PartyMaterial, Error, { id: string } & ReturnPartyMaterialInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<PartyMaterial>(`/party-materials/${id}/return`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialsKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // A return posts a ledger row → the party stock ledger changes too.
      void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
    },
  });
}

/** ADR-197: a delete carries its reason (required by the API). */
export function useDeletePartyMaterial() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<void>(`/party-materials/${id}`, { method: 'DELETE', json: { reason } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyMaterialsKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
