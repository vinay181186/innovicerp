import type {
  CreateCustomerDispatchInput,
  CustomerDispatchDetail,
  CustomerDispatchRegisterQuery,
  CustomerDispatchRegisterResponse,
  DispatchableSoResponse,
  DocumentEditStagedResult,
  FinanceSoOption,
  ListCustomerDispatchesResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

/** PATCH /customer-dispatches/:id payload. Defined here (not in the shared
 *  contract yet — the backend half is being built in parallel; this mirrors the
 *  natural field names so the frontend compiles and works a normal update until
 *  the staged-edit server lands). Only the header fields the create form carries
 *  and each existing LINE's dispatch qty are editable; the SO and the set of
 *  items cannot change on an existing dispatch. `reason` rides along for the
 *  activity-log entry (ADR-197), as on the other edit screens. */
export interface UpdateCustomerDispatchInput {
  // ADR-226 / §20.4 — the version the form LOADED. The server has accepted it all
  // along (`expectedUpdatedAt: z.string().optional()` in its own schema, checked
  // under the dispatch's row lock) and this screen simply never sent one, so a
  // save over somebody else's newer edit went through silently. That matters more
  // here than on most documents: the save bumps the dispatch's revision and
  // reverses then reposts the whole stock movement.
  expectedUpdatedAt?: string | undefined;
  // `null` clears the field — the server's schema is `.nullable().optional()` and
  // writes `input.transport ?? null`. The screen used to send `undefined` for a
  // cleared box, which JSON drops, so emptying one never saved.
  dispatchDate?: string | undefined;
  transport?: string | null | undefined;
  vehicleNo?: string | null | undefined;
  remarks?: string | null | undefined;
  /** One entry per existing dispatch line, keyed by customer_dispatch_lines.id —
   *  the same id the staged-edit diff uses in its `line:<id>:qty` change key. The
   *  line SET is fixed (the server refuses an added / removed line) and `qty` is
   *  required on every entry, so the whole array always travels. */
  lines: { id: string; qty: number }[];
  reason?: string | undefined;
}

export const dispatchKeys = {
  all: ['customer-dispatches'] as const,
  list: () => [...dispatchKeys.all, 'list'] as const,
  register: (q?: CustomerDispatchRegisterQuery) =>
    q
      ? ([...dispatchKeys.all, 'register', q] as const)
      : ([...dispatchKeys.all, 'register'] as const),
  detail: (id: string) => [...dispatchKeys.all, 'detail', id] as const,
  soOptions: () => [...dispatchKeys.all, 'so-options'] as const,
  dispatchable: (soId: string) => [...dispatchKeys.all, 'dispatchable', soId] as const,
  nextCode: () => [...dispatchKeys.all, 'next-code'] as const,
};

// Read-only preview of the DSP-#### code the server will assign on save.
export function useNextDispatchCode() {
  return useQuery<{ code: string }>({
    queryKey: dispatchKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/customer-dispatches/next-code'),
    staleTime: 0,
  });
}

export function useDispatchList() {
  return useQuery<ListCustomerDispatchesResponse>({
    queryKey: dispatchKeys.list(),
    queryFn: () => apiFetch<ListCustomerDispatchesResponse>('/customer-dispatches'),
    staleTime: 15_000,
  });
}

// Single dispatch w/ lines — used by the invoice form to prefill from a dispatch.
export function useDispatchDetail(id: string | undefined) {
  return useQuery<CustomerDispatchDetail>({
    queryKey: id ? dispatchKeys.detail(id) : dispatchKeys.detail('__none__'),
    queryFn: () => apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}`),
    enabled: Boolean(id),
  });
}

function registerQs(q: CustomerDispatchRegisterQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.soNo) params.set('soNo', q.soNo);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  if (q.sf) params.set('sf', q.sf);
  return params.toString();
}

/** One page of the line-grain register, paged by DISPATCH (ADR-201). */
export function fetchDispatchRegister(
  q: CustomerDispatchRegisterQuery,
): Promise<CustomerDispatchRegisterResponse> {
  return apiFetch<CustomerDispatchRegisterResponse>(
    `/customer-dispatches/register?${registerQs(q)}`,
  );
}

// Line-grain register (legacy renderDispatchRegister grain).
export function useDispatchRegister(q: CustomerDispatchRegisterQuery) {
  return useQuery<CustomerDispatchRegisterResponse>({
    queryKey: dispatchKeys.register(q),
    queryFn: () => fetchDispatchRegister(q),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useFinanceSoOptions() {
  return useQuery<{ options: FinanceSoOption[] }>({
    queryKey: dispatchKeys.soOptions(),
    queryFn: () => apiFetch<{ options: FinanceSoOption[] }>('/customer-dispatches/so-options'),
    staleTime: 30_000,
  });
}

/** Re-read ONE dispatch from the server, bypassing the cache (ADR-226).
 *
 *  Only used after a save was refused 409 `edit_conflict`: the edit screen needs
 *  the row AS IT IS NOW to work out which fields the other person changed and to
 *  retry onto their version. `staleTime: 0` is the whole point — the cached copy
 *  is the stale photograph we are trying to get past. */
export function useFetchDispatchDetail(): (id: string) => Promise<CustomerDispatchDetail> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<CustomerDispatchDetail>({
        queryKey: dispatchKeys.detail(id),
        queryFn: () => apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
}

export function useDispatchableSo(soId: string | undefined) {
  return useQuery<DispatchableSoResponse>({
    queryKey: soId ? dispatchKeys.dispatchable(soId) : dispatchKeys.dispatchable('__none__'),
    queryFn: () => apiFetch<DispatchableSoResponse>(`/customer-dispatches/dispatchable/${soId}`),
    enabled: Boolean(soId),
  });
}

export function useCreateDispatch(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, CreateCustomerDispatchInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<CustomerDispatchDetail>('/customer-dispatches', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}

/**
 * Edit an existing dispatch (ADR-202). PATCH /customer-dispatches/:id returns the
 * updated dispatch normally, OR a DocumentEditStagedResult when the edit-approval
 * gate is on and this dispatch is live — then nothing changed and the edit is
 * waiting for approval. Mirrors useUpdateSalesOrder: on a staged result refresh
 * the detail + ['document-edits'] (so the pending chips appear) and stop; on a
 * normal save invalidate the dispatch caches as an update would.
 */
export function useUpdateCustomerDispatch(id: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<
    CustomerDispatchDetail | DocumentEditStagedResult,
    Error,
    UpdateCustomerDispatchInput
  >({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<CustomerDispatchDetail | DocumentEditStagedResult>(`/customer-dispatches/${id}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (updated) => {
      // ADR-197 — the dispatch's History tab reads the activity log either way.
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      if ('staged' in updated) {
        // Nothing changed on the dispatch itself — refresh so the detail page
        // shows the new pending-change chips.
        void qc.invalidateQueries({ queryKey: dispatchKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
    },
  });
}

/** Cancel reverses the dispatch; the reason is required (ADR-197). */
export function useCancelDispatch() {
  const qc = useQueryClient();
  return useMutation<CustomerDispatchDetail, Error, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dispatchKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
