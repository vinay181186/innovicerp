// TanStack Query hooks for Multi-Level BOM (ADR-225). A separate document from
// BOM Master — mirrors modules/bom-master/api.ts, nothing shared with it.

import type {
  CreateMlBomInput,
  DeleteMlBomInput,
  ListMlBomsQuery,
  ListMlBomsResponse,
  MakeDefaultMlBomInput,
  MlBomDetail,
  MlBomImportInput,
  MlBomCostResponse,
  MlBomImportResult,
  MlBomTreeResponse,
  UpdateMlBomInput,
} from '@innovic/shared';
import {
  type QueryClient,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const mlBomsKeys = {
  all: ['ml-boms'] as const,
  lists: () => [...mlBomsKeys.all, 'list'] as const,
  list: (q: ListMlBomsQuery) => [...mlBomsKeys.lists(), q] as const,
  details: () => [...mlBomsKeys.all, 'detail'] as const,
  detail: (id: string) => [...mlBomsKeys.details(), id] as const,
  tree: (id: string, qty: number) => [...mlBomsKeys.detail(id), 'tree', qty] as const,
  cost: (id: string, qty: number) => [...mlBomsKeys.detail(id), 'cost', qty] as const,
  nextCode: () => [...mlBomsKeys.all, 'next-code'] as const,
};

function toQueryString(q: ListMlBomsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useMlBomsList(
  query: ListMlBomsQuery,
  options?: Omit<UseQueryOptions<ListMlBomsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMlBomsResponse>({
    queryKey: mlBomsKeys.list(query),
    queryFn: () => apiFetch<ListMlBomsResponse>(`/ml-boms?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useMlBom(id: string | undefined) {
  return useQuery<MlBomDetail>({
    queryKey: id ? mlBomsKeys.detail(id) : mlBomsKeys.detail('__missing__'),
    queryFn: () => apiFetch<MlBomDetail>(`/ml-boms/${id}`),
    enabled: Boolean(id),
  });
}

/** The whole tree + the exploded leaf list for `qty` top units. */
export function useMlBomTree(id: string | undefined, qty: number, enabled = true) {
  return useQuery<MlBomTreeResponse>({
    queryKey: mlBomsKeys.tree(id ?? '__missing__', qty),
    queryFn: () => apiFetch<MlBomTreeResponse>(`/ml-boms/${id}/tree?qty=${qty}`),
    enabled: Boolean(id) && enabled && Number.isFinite(qty) && qty > 0,
    placeholderData: (prev) => prev,
  });
}

/** Print: the tree for exactly `qty`, always asked fresh (never a cached
 *  error or an old figure). Shares the Tree tab's cache key. */
export function fetchMlBomTree(
  qc: QueryClient,
  id: string,
  qty: number,
): Promise<MlBomTreeResponse> {
  return qc.fetchQuery<MlBomTreeResponse>({
    queryKey: mlBomsKeys.tree(id, qty),
    queryFn: () => apiFetch<MlBomTreeResponse>(`/ml-boms/${id}/tree?qty=${qty}`),
    staleTime: 0,
  });
}

/** ADR-225 phase 6 — the cost estimate for `qty` top units. 403 when the
 *  user may not see prices; not retried. */
export function useMlBomCost(id: string | undefined, qty: number, enabled = true) {
  return useQuery<MlBomCostResponse>({
    queryKey: mlBomsKeys.cost(id ?? '__missing__', qty),
    queryFn: () => apiFetch<MlBomCostResponse>(`/ml-boms/${id}/cost?qty=${qty}`),
    enabled: Boolean(id) && enabled && Number.isFinite(qty) && qty > 0,
    // No placeholderData: a new Qty / BOM shows the loading state, never the
    // old figures beside the new Qty.
    retry: (count, err) => !(err instanceof ApiError && err.status === 403) && count < 2,
  });
}

/** ADR-224 — a PREVIEW of the next BOM No.; the server numbers it on save. */
export function useNextMlBomNo(options?: { enabled?: boolean }) {
  return useQuery<{ code: string }>({
    queryKey: mlBomsKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/ml-boms/next-code'),
    staleTime: 0,
    enabled: options?.enabled ?? true,
  });
}

/** A save can move the Default flag or a sub-assembly link on OTHER BOMs, so
 *  every list and detail is refreshed, not just this one. */
function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: mlBomsKeys.lists() });
  void qc.invalidateQueries({ queryKey: mlBomsKeys.details() });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateMlBom(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MlBomDetail, Error, CreateMlBomInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MlBomDetail>('/ml-boms', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      invalidateAll(qc);
      // ADR-224: the next preview must be re-asked (sibling of lists()).
      void qc.invalidateQueries({ queryKey: mlBomsKeys.nextCode() });
      qc.setQueryData(mlBomsKeys.detail(created.id), created);
    },
  });
}

export function useUpdateMlBom(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MlBomDetail, Error, UpdateMlBomInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MlBomDetail>(`/ml-boms/${id}`, {
          method: 'PUT',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      invalidateAll(qc);
      qc.setQueryData(mlBomsKeys.detail(updated.id), updated);
    },
  });
}

export function useMakeDefaultMlBom() {
  const qc = useQueryClient();
  return useMutation<MlBomDetail, Error, { id: string } & MakeDefaultMlBomInput>({
    mutationFn: ({ id, expectedUpdatedAt }) =>
      apiFetch<MlBomDetail>(`/ml-boms/${id}/make-default`, {
        method: 'POST',
        json: { expectedUpdatedAt },
      }),
    onSuccess: (updated) => {
      invalidateAll(qc);
      qc.setQueryData(mlBomsKeys.detail(updated.id), updated);
    },
  });
}

export function useDeleteMlBom() {
  const qc = useQueryClient();
  // ADR-197: the reason is required by DELETE /ml-boms/:id (deleteMlBomInputSchema).
  return useMutation<unknown, Error, { id: string } & DeleteMlBomInput>({
    mutationFn: ({ id, reason }) =>
      apiFetch<unknown>(`/ml-boms/${id}`, { method: 'DELETE', json: { reason } }),
    onSuccess: () => {
      invalidateAll(qc);
      // "Highest live number + 1" — deleting the newest frees its number.
      void qc.invalidateQueries({ queryKey: mlBomsKeys.nextCode() });
    },
  });
}

/** ADR-225 phase 2 — POST /ml-boms/import. The Preview (dryRun true) carries no
 *  save key: a preview is not a save. The Import carries the dialog's ONE key,
 *  reused on a retry after a timeout, so the file is never imported twice. */
export function useImportMlBoms() {
  const qc = useQueryClient();
  return useMutation<
    MlBomImportResult,
    Error,
    { input: MlBomImportInput; saveKey?: SaveKey | undefined }
  >({
    mutationFn: ({ input, saveKey }) =>
      withSaveKey(input.dryRun ? undefined : saveKey, (headers) =>
        apiFetch<MlBomImportResult>('/ml-boms/import', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (res) => {
      if (!res.saved) return;
      invalidateAll(qc);
      void qc.invalidateQueries({ queryKey: mlBomsKeys.nextCode() });
    },
  });
}
