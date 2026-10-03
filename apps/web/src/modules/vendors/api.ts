import type {
  BulkCreateVendorsInput,
  BulkCreateVendorsResponse,
  CreateVendorInput,
  DocumentEditStagedResult,
  ListVendorsQuery,
  ListVendorsResponse,
  UpdateVendorInput,
  Vendor,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

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
  if (q.sortBy) params.set('sortBy', q.sortBy);
  if (q.sortDir) params.set('sortDir', q.sortDir);
  if (q.sf) params.set('sf', q.sf);
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

export function useNextVendorCode() {
  return useQuery<{ code: string }>({
    queryKey: [...vendorsKeys.all, 'next-code'],
    queryFn: () => apiFetch<{ code: string }>('/vendors/next-code'),
    staleTime: 0,
  });
}

export function useVendor(id: string | undefined) {
  return useQuery<Vendor>({
    queryKey: id ? vendorsKeys.detail(id) : vendorsKeys.detail('__missing__'),
    queryFn: () => apiFetch<Vendor>(`/vendors/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateVendor(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Vendor, Error, CreateVendorInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Vendor>('/vendors', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      qc.setQueryData(vendorsKeys.detail(created.id), created);
    },
  });
}

/** Whole-sheet Excel import: ONE request, ONE list reload at the end.
 *
 *  The importer used to loop useCreateVendor over the rows, and each success
 *  invalidated the list — so the browser re-downloaded the entire vendor master
 *  after every row, getting slower as the master grew. Measured live at about
 *  one vendor per second. */
export function useBulkCreateVendors() {
  const qc = useQueryClient();
  return useMutation<
    BulkCreateVendorsResponse,
    Error,
    BulkCreateVendorsInput & { saveKey?: SaveKey | undefined }
  >({
    // A big sheet can take over a minute — give it three. Only the real import
    // (dryRun: false) carries the dialog's save key; a preview is not a save,
    // and sharing the key would make the server replay the preview's answer.
    mutationFn: ({ saveKey, ...input }) =>
      withSaveKey(input.dryRun ? undefined : saveKey, (headers) =>
        apiFetch<BulkCreateVendorsResponse>('/vendors/bulk', {
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
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
    },
  });
}

export function useUpdateVendor(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the vendor is live, the PATCH
  // returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated vendor. The edit page reads the union to tell them apart.
  return useMutation<Vendor | DocumentEditStagedResult, Error, UpdateVendorInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Vendor | DocumentEditStagedResult>(`/vendors/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      if ('staged' in updated) {
        // Nothing changed on the vendor itself — just refresh so the detail page
        // shows the new pending-change chips.
        void qc.invalidateQueries({ queryKey: vendorsKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      qc.setQueryData(vendorsKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteVendor() {
  const qc = useQueryClient();
  // ADR-197: a reason is required to move a record to Trash.
  return useMutation<void, Error, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      await apiFetch<null>(`/vendors/${id}`, { method: 'DELETE', json: { reason } });
    },
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: vendorsKeys.lists() });
      qc.removeQueries({ queryKey: vendorsKeys.detail(id) });
    },
  });
}
