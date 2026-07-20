import type {
  CreateJwDcInwardInput,
  CreateJwDcOutwardInput,
  JwDcInward,
  JwDcOutward,
  JwDcOutwardDetail,
  JwDcPoLinesResponse,
  ListJwDcInwardQuery,
  ListJwDcInwardResponse,
  ListJwDcOutwardQuery,
  ListJwDcOutwardResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jwDcKeys = {
  all: ['jw-dc'] as const,
  outwardList: (q: ListJwDcOutwardQuery) =>
    [
      ...jwDcKeys.all,
      'outward',
      'list',
      q.search ?? null,
      q.vendorId ?? null,
      q.purchaseOrderId ?? null,
      q.returnStatus ?? null,
      q.limit,
      q.offset,
    ] as const,
  outwardDetail: (id: string) => [...jwDcKeys.all, 'outward', 'detail', id] as const,
  outwardNextCode: () => [...jwDcKeys.all, 'outward', 'next-code'] as const,
  inwardNextCode: () => [...jwDcKeys.all, 'inward', 'next-code'] as const,
  poLines: (poId: string) => [...jwDcKeys.all, 'po-lines', poId] as const,
  inwardList: (q: ListJwDcInwardQuery) =>
    [
      ...jwDcKeys.all,
      'inward',
      'list',
      q.search ?? null,
      q.jwDcOutwardId ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildOutwardSearch(q: ListJwDcOutwardQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.vendorId) params.set('vendorId', q.vendorId);
  if (q.purchaseOrderId) params.set('purchaseOrderId', q.purchaseOrderId);
  if (q.returnStatus) params.set('returnStatus', q.returnStatus);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

function buildInwardSearch(q: ListJwDcInwardQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jwDcOutwardId) params.set('jwDcOutwardId', q.jwDcOutwardId);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJwDcOutwardList(query: ListJwDcOutwardQuery) {
  return useQuery<ListJwDcOutwardResponse>({
    queryKey: jwDcKeys.outwardList(query),
    queryFn: () =>
      apiFetch<ListJwDcOutwardResponse>(`/jw-dc/outward?${buildOutwardSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useJwDcOutwardDetail(id: string | undefined) {
  return useQuery<JwDcOutwardDetail>({
    queryKey: jwDcKeys.outwardDetail(id ?? '__missing__'),
    queryFn: () => apiFetch<JwDcOutwardDetail>(`/jw-dc/outward/${id}`),
    enabled: Boolean(id),
  });
}

export function useJwDcPoLines(poId: string | undefined) {
  return useQuery<JwDcPoLinesResponse>({
    queryKey: jwDcKeys.poLines(poId ?? '__missing__'),
    queryFn: () => apiFetch<JwDcPoLinesResponse>(`/jw-dc/po-lines/${poId}`),
    enabled: Boolean(poId),
  });
}

export function useCreateJwDcOutward() {
  const qc = useQueryClient();
  return useMutation<JwDcOutward, Error, CreateJwDcOutwardInput>({
    mutationFn: (input) =>
      apiFetch<JwDcOutward>('/jw-dc/outward', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwDcKeys.all });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
    },
  });
}

export function useNextOutwardCode() {
  return useQuery<{ code: string }>({
    queryKey: jwDcKeys.outwardNextCode(),
    queryFn: () => apiFetch<{ code: string }>('/jw-dc/outward/next-code'),
    staleTime: 0,
  });
}

export function useNextInwardCode() {
  return useQuery<{ code: string }>({
    queryKey: jwDcKeys.inwardNextCode(),
    queryFn: () => apiFetch<{ code: string }>('/jw-dc/inward/next-code'),
    staleTime: 0,
  });
}

export function useJwDcInwardList(query: ListJwDcInwardQuery) {
  return useQuery<ListJwDcInwardResponse>({
    queryKey: jwDcKeys.inwardList(query),
    queryFn: () =>
      apiFetch<ListJwDcInwardResponse>(`/jw-dc/inward?${buildInwardSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreateJwDcInward() {
  const qc = useQueryClient();
  return useMutation<JwDcInward, Error, CreateJwDcInwardInput>({
    mutationFn: (input) =>
      apiFetch<JwDcInward>('/jw-dc/inward', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwDcKeys.all });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
    },
  });
}
