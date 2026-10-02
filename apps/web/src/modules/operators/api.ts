import type {
  BulkCreateOperatorsInput,
  BulkCreateOperatorsResponse,
  CreateOperatorInput,
  ListOperatorsQuery,
  ListOperatorsResponse,
  Operator,
  UpdateOperatorInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';

export const operatorsKeys = {
  all: ['operators'] as const,
  lists: () => [...operatorsKeys.all, 'list'] as const,
  list: (q: ListOperatorsQuery) => [...operatorsKeys.lists(), q] as const,
  details: () => [...operatorsKeys.all, 'detail'] as const,
  detail: (id: string) => [...operatorsKeys.details(), id] as const,
};

function toQueryString(q: ListOperatorsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useOperatorsList(
  query: ListOperatorsQuery,
  options?: Omit<UseQueryOptions<ListOperatorsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListOperatorsResponse>({
    queryKey: operatorsKeys.list(query),
    queryFn: () => apiFetch<ListOperatorsResponse>(`/operators?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useNextOperatorCode() {
  return useQuery<{ code: string }>({
    queryKey: [...operatorsKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/operators/next-code'),
    staleTime: 0,
  });
}

export function useOperator(id: string | undefined) {
  return useQuery<Operator>({
    queryKey: id ? operatorsKeys.detail(id) : operatorsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Operator>(`/operators/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateOperator(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Operator, Error, CreateOperatorInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Operator>('/operators', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.setQueryData(operatorsKeys.detail(created.id), created);
    },
  });
}

/** Whole-sheet Excel import: ONE request, ONE list reload at the end.
 *
 *  The importer used to loop useCreateOperator over the rows, and each success
 *  invalidated the list — so the browser re-downloaded the entire operator
 *  master after every row, getting slower as the master grew. Measured live on
 *  the vendors import (same code shape) at about one row per second. */
export function useBulkCreateOperators() {
  const qc = useQueryClient();
  return useMutation<
    BulkCreateOperatorsResponse,
    Error,
    BulkCreateOperatorsInput & { saveKey?: SaveKey | undefined }
  >({
    // A big sheet can take over a minute — give it three. Only the real import
    // (dryRun: false) carries the dialog's save key; a preview is not a save,
    // and sharing the key would make the server replay the preview's answer.
    mutationFn: ({ saveKey, ...input }) =>
      withSaveKey(input.dryRun ? undefined : saveKey, (headers) =>
        apiFetch<BulkCreateOperatorsResponse>('/operators/bulk', {
          method: 'POST',
          json: input,
          timeoutMs: 180_000,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (_res, input) => {
      // A preview (dryRun) writes nothing — nothing to reload.
      if (input.dryRun) return;
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
    },
  });
}

export function useUpdateOperator(id: string) {
  const qc = useQueryClient();
  return useMutation<Operator, Error, UpdateOperatorInput>({
    mutationFn: (input) => apiFetch<Operator>(`/operators/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.setQueryData(operatorsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteOperator() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/operators/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: operatorsKeys.lists() });
      qc.removeQueries({ queryKey: operatorsKeys.detail(id) });
    },
  });
}
