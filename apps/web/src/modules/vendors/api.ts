import type {
  CreateVendorInput,
  ListVendorsQuery,
  ListVendorsResponse,
  UpdateVendorInput,
  Vendor,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const vendorsKeys = {
  all: ['vendors'] as const,
  lists: () => [...vendorsKeys.all, 'list'] as const,
  list: (q: ListVendorsQuery) => [...vendorsKeys.lists(), q] as const,
  details: () => [...vendorsKeys.all, 'detail'] as const,
  detail: (id: string) => [...vendorsKeys.details(), id] as const,
};

function toQueryString(q: ListVendorsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useVendorsList(
  query: ListVendorsQuery,
  options?: Omit<UseQueryOptions<ListVendorsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListVendorsResponse>({
    queryKey: vendorsKeys.list(query),
    queryFn: () => apiFetch<ListVendorsResponse>(`/vendors?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useVendor(id: string | undefined) {
  return useQuery<Vendor>({
    queryKey: id ? vendorsKeys.detail(id) : vendorsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Vendor>(`/vendors/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation<Vendor, Error, CreateVendorInput>({
    mutationFn: (input) => apiFetch<Vendor>('/vendors', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      qc.setQueryData(vendorsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateVendor(id: string) {
  const qc = useQueryClient();
  return useMutation<Vendor, Error, UpdateVendorInput>({
    mutationFn: (input) => apiFetch<Vendor>(`/vendors/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      qc.setQueryData(vendorsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteVendor() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/vendors/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      qc.removeQueries({ queryKey: vendorsKeys.detail(id) });
    },
  });
}
