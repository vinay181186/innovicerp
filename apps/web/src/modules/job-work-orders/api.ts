import type {
  CreateJobWorkOrderInput,
  EnsureJwRmItemInput,
  EnsureJwRmItemResponse,
  JobWorkOrderDetail,
  ListJobWorkOrdersQuery,
  ListJobWorkOrdersResponse,
  ShortCloseJobWorkOrderLineInput,
  UpdateJobWorkOrderInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const jobWorkOrdersKeys = {
  all: ['job-work-orders'] as const,
  lists: () => [...jobWorkOrdersKeys.all, 'list'] as const,
  list: (q: ListJobWorkOrdersQuery) => [...jobWorkOrdersKeys.lists(), q] as const,
  details: () => [...jobWorkOrdersKeys.all, 'detail'] as const,
  detail: (id: string) => [...jobWorkOrdersKeys.details(), id] as const,
};

function toQueryString(q: ListJobWorkOrdersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useJobWorkOrdersList(
  query: ListJobWorkOrdersQuery,
  options?: Omit<UseQueryOptions<ListJobWorkOrdersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListJobWorkOrdersResponse>({
    queryKey: jobWorkOrdersKeys.list(query),
    queryFn: () => apiFetch<ListJobWorkOrdersResponse>(`/job-work-orders?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useJobWorkOrder(id: string | undefined) {
  return useQuery<JobWorkOrderDetail>({
    queryKey: id ? jobWorkOrdersKeys.detail(id) : jobWorkOrdersKeys.detail('__missing__'),
    queryFn: () => apiFetch<JobWorkOrderDetail>(`/job-work-orders/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateJobWorkOrder(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<JobWorkOrderDetail, Error, CreateJobWorkOrderInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<JobWorkOrderDetail>('/job-work-orders', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.setQueryData(jobWorkOrdersKeys.detail(created.id), created);
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

export function useUpdateJobWorkOrder(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<JobWorkOrderDetail, Error, UpdateJobWorkOrderInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<JobWorkOrderDetail>(`/job-work-orders/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.setQueryData(jobWorkOrdersKeys.detail(id), updated);
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

/** ADR-203: find-or-create the customer RM (`<item code>-RM`) for an order
 *  item. Called silently by the JWSO form the moment a line's item is picked —
 *  no popup. Idempotent server-side: the same item always returns the same RM;
 *  `created` is true only on the call that made it (the line shows "new"). */
export function useEnsureJwRmItem() {
  return useMutation<EnsureJwRmItemResponse, Error, EnsureJwRmItemInput>({
    mutationFn: (input) =>
      apiFetch<EnsureJwRmItemResponse>('/job-work-orders/rm-item', {
        method: 'POST',
        json: input,
      }),
  });
}

/** R6 (ADR-194): short-close ONE JWSO line — close it with the balance left
 *  unmet. Sets status='closed' and stamps shortClosedAt/By + reason on the line.
 *  Reuses jw_create. The line is addressed under its JWSO for context. */
export function useShortCloseJobWorkOrderLine(jwId: string) {
  const qc = useQueryClient();
  return useMutation<
    JobWorkOrderDetail,
    Error,
    { lineId: string } & ShortCloseJobWorkOrderLineInput
  >({
    mutationFn: ({ lineId, reason }) =>
      apiFetch<JobWorkOrderDetail>(`/job-work-order-lines/${lineId}/short-close`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.setQueryData(jobWorkOrdersKeys.detail(jwId), updated);
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

/** Move a JWSO to Trash. ADR-197: the reason is required and lands on the
 *  JWSO's History row. */
export function useSoftDeleteJobWorkOrder() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/job-work-orders/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.lists() });
      qc.removeQueries({ queryKey: jobWorkOrdersKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
