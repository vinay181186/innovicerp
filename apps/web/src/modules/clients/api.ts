import type {
  BulkCreateClientsInput,
  BulkCreateClientsResponse,
  Client,
  CreateClientInput,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  if (q.sortBy) params.set('sortBy', q.sortBy);
  if (q.sortDir) params.set('sortDir', q.sortDir);
  if (q.sf) params.set('sf', q.sf);
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

export function useNextClientCode() {
  return useQuery<{ code: string }>({
    queryKey: [...clientsKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/clients/next-code'),
    staleTime: 0,
  });
}

export function useClient(id: string | undefined) {
  return useQuery<Client>({
    queryKey: id ? clientsKeys.detail(id) : clientsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Client>(`/clients/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateClient(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Client, Error, CreateClientInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Client>('/clients', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.setQueryData(clientsKeys.detail(created.id), created);
    },
  });
}

/** Whole-sheet Excel import: ONE request, ONE list reload at the end.
 *
 *  The importer used to loop useCreateClient over the rows, and each success
 *  invalidated the list — so the browser re-downloaded the entire client master
 *  after every row, getting slower as the master grew. Measured live on the
 *  identical vendor import at about one row per second, i.e. nine minutes for a
 *  500-row sheet. */
export function useBulkCreateClients() {
  const qc = useQueryClient();
  return useMutation<
    BulkCreateClientsResponse,
    Error,
    BulkCreateClientsInput & { saveKey?: SaveKey | undefined }
  >({
    // A big sheet can take over a minute — give it three. Only the real import
    // (dryRun: false) carries the dialog's save key; a preview is not a save,
    // and sharing the key would make the server replay the preview's answer.
    mutationFn: ({ saveKey, ...input }) =>
      withSaveKey(input.dryRun ? undefined : saveKey, (headers) =>
        apiFetch<BulkCreateClientsResponse>('/clients/bulk', {
          method: 'POST',
          json: input,
          timeoutMs: 180_000,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (_res, input) => {
      // A preview (dryRun) writes nothing — nothing to reload.
      if (input.dryRun) return;
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
    },
  });
}

export function useUpdateClient(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Client, Error, UpdateClientInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Client>(`/clients/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.setQueryData(clientsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteClient() {
  const qc = useQueryClient();
  // ADR-197: a reason is required to move a record to Trash.
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/clients/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: clientsKeys.lists() });
      qc.removeQueries({ queryKey: clientsKeys.detail(id) });
    },
  });
}
