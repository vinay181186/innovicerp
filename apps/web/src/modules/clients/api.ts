import type {
  Client,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from '@innovic/shared';
import {
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const clientsKeys = {
  all: ['clients'] as const,
  lists: () => [...clientsKeys.all, 'list'] as const,
  list: (q: ListClientsQuery) => [...clientsKeys.lists(), q] as const,
  details: () => [...clientsKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientsKeys.details(), id] as const,
};

function toQueryString(q: ListClientsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useClientsList(
  query: ListClientsQuery,
  options?: Omit<UseQueryOptions<ListClientsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListClientsResponse>({
    queryKey: clientsKeys.list(query),
    queryFn: () => apiFetch<ListClientsResponse>(`/clients?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useClient(id: string | undefined) {
  return useQuery<Client>({
    queryKey: id ? clientsKeys.detail(id) : clientsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Client>(`/clients/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation<Client, Error, CreateClientInput>({
    mutationFn: (input) => apiFetch<Client>('/clients', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.setQueryData(clientsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateClient(id: string) {
  const qc = useQueryClient();
  return useMutation<Client, Error, UpdateClientInput>({
    mutationFn: (input) => apiFetch<Client>(`/clients/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.setQueryData(clientsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteClient() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/clients/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.removeQueries({ queryKey: clientsKeys.detail(id) });
    },
  });
}
