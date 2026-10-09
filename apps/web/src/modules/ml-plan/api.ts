// TanStack Query hooks for Multi-Level Plan (ADR-225 phase 3). Same shape as
// modules/ml-bom/api.ts — nothing shared with it.

import type {
  CancelMlPlanInput,
  CreateMlPlanInput,
  ListMlPlansQuery,
  ListMlPlansResponse,
  MlPlanDetail,
  MlPlanEligibleLinesQuery,
  MlPlanEligibleLinesResponse,
  RaiseMlPlanOrdersInput,
  RefreshMlPlanInput,
  UpdateMlPlanInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { plansKeys } from '@/modules/plans/api';
import { purchaseRequestsKeys } from '@/modules/purchase-requests/api';

type EligibleQuery = Partial<Pick<MlPlanEligibleLinesQuery, 'search' | 'salesOrderId'>> & {
  limit?: number;
};

export const mlPlansKeys = {
  all: ['ml-plans'] as const,
  lists: () => [...mlPlansKeys.all, 'list'] as const,
  list: (q: ListMlPlansQuery) => [...mlPlansKeys.lists(), q] as const,
  details: () => [...mlPlansKeys.all, 'detail'] as const,
  detail: (id: string) => [...mlPlansKeys.details(), id] as const,
  nextCode: () => [...mlPlansKeys.all, 'next-code'] as const,
  eligibleAll: () => [...mlPlansKeys.all, 'eligible-lines'] as const,
  eligible: (q: EligibleQuery) => [...mlPlansKeys.eligibleAll(), q] as const,
};

function toQueryString(q: ListMlPlansQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.salesOrderId) params.set('salesOrderId', q.salesOrderId);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useMlPlansList(
  query: ListMlPlansQuery,
  options?: Omit<UseQueryOptions<ListMlPlansResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMlPlansResponse>({
    queryKey: mlPlansKeys.list(query),
    queryFn: () => apiFetch<ListMlPlansResponse>(`/ml-plans?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useMlPlan(id: string | undefined) {
  return useQuery<MlPlanDetail>({
    queryKey: id ? mlPlansKeys.detail(id) : mlPlansKeys.detail('__missing__'),
    queryFn: () => apiFetch<MlPlanDetail>(`/ml-plans/${id}`),
    enabled: Boolean(id),
  });
}

/** ADR-224 — a PREVIEW of the next MLP No.; the server numbers it on save. */
export function useNextMlPlanNo(options?: { enabled?: boolean }) {
  return useQuery<{ code: string }>({
    queryKey: mlPlansKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/ml-plans/next-code'),
    staleTime: 0,
    enabled: options?.enabled ?? true,
  });
}

/** SO lines a Multi-Level Plan can be made for — the server decides which. */
export function useMlPlanEligibleLines(q: EligibleQuery, options?: { enabled?: boolean }) {
  return useQuery<MlPlanEligibleLinesResponse>({
    queryKey: mlPlansKeys.eligible(q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.search) params.set('search', q.search);
      if (q.salesOrderId) params.set('salesOrderId', q.salesOrderId);
      params.set('limit', String(q.limit ?? 25));
      return apiFetch<MlPlanEligibleLinesResponse>(`/ml-plans/eligible-lines?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
    staleTime: 0,
    enabled: options?.enabled ?? true,
  });
}

/** A create / cancel changes which SO lines are eligible, so that list is
 *  re-asked too, along with every list, detail and the History tab. */
function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: mlPlansKeys.lists() });
  void qc.invalidateQueries({ queryKey: mlPlansKeys.details() });
  void qc.invalidateQueries({ queryKey: mlPlansKeys.eligibleAll() });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateMlPlan(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MlPlanDetail, Error, CreateMlPlanInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MlPlanDetail>('/ml-plans', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      invalidateAll(qc);
      void qc.invalidateQueries({ queryKey: mlPlansKeys.nextCode() });
      qc.setQueryData(mlPlansKeys.detail(created.id), created);
    },
  });
}

export function useUpdateMlPlan(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MlPlanDetail, Error, UpdateMlPlanInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MlPlanDetail>(`/ml-plans/${id}`, {
          method: 'PUT',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      invalidateAll(qc);
      qc.setQueryData(mlPlansKeys.detail(updated.id), updated);
    },
  });
}

export function useRefreshMlPlan() {
  const qc = useQueryClient();
  return useMutation<MlPlanDetail, Error, { id: string } & RefreshMlPlanInput>({
    mutationFn: ({ id, expectedUpdatedAt }) =>
      apiFetch<MlPlanDetail>(`/ml-plans/${id}/refresh`, {
        method: 'POST',
        json: { expectedUpdatedAt },
      }),
    onSuccess: (updated) => {
      invalidateAll(qc);
      qc.setQueryData(mlPlansKeys.detail(updated.id), updated);
    },
  });
}

export function useCancelMlPlan() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & CancelMlPlanInput>({
    mutationFn: ({ id, reason, expectedUpdatedAt }) =>
      apiFetch<unknown>(`/ml-plans/${id}/cancel`, {
        method: 'POST',
        json: { reason, expectedUpdatedAt },
      }),
    onSuccess: () => invalidateAll(qc),
  });
}

/** ADR-225 phase 4 — raise Plans / PRs from the chosen rows. One request is one
 *  transaction on the server; the save key makes a retry replay, not repeat. */
export function useRaiseMlPlanOrders(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MlPlanDetail, Error, RaiseMlPlanOrdersInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MlPlanDetail>(`/ml-plans/${id}/orders`, {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      invalidateAll(qc);
      // The new Plans / PRs show on their own lists.
      void qc.invalidateQueries({ queryKey: plansKeys.all });
      void qc.invalidateQueries({ queryKey: purchaseRequestsKeys.all });
      qc.setQueryData(mlPlansKeys.detail(updated.id), updated);
    },
  });
}
