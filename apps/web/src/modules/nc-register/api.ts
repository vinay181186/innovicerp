import type {
  CloseNcReworkInput,
  CreateNcDcInput,
  CreateNcDcResult,
  CreateNcRegisterInput,
  DisposeNcInput,
  DisposeNcResult,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterSummary,
  UpdateNcRegisterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deliveryChallansKeys } from '@/modules/delivery-challans/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { opEntryKeys } from '@/modules/op-entry/api';
import { apiFetch } from '@/lib/api';

export const ncRegisterKeys = {
  all: ['nc-register'] as const,
  lists: () => [...ncRegisterKeys.all, 'list'] as const,
  list: (q: ListNcRegisterQuery) => [...ncRegisterKeys.lists(), q] as const,
  details: () => [...ncRegisterKeys.all, 'detail'] as const,
  detail: (id: string) => [...ncRegisterKeys.details(), id] as const,
  summary: () => [...ncRegisterKeys.all, 'summary'] as const,
};

export function useNcRegisterSummary(
  options?: Omit<UseQueryOptions<NcRegisterSummary>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<NcRegisterSummary>({
    queryKey: ncRegisterKeys.summary(),
    queryFn: () => apiFetch<NcRegisterSummary>('/nc-register/summary'),
    placeholderData: (prev) => prev,
    ...options,
  });
}

function toQueryString(q: ListNcRegisterQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.reasonCategory) params.set('reasonCategory', q.reasonCategory);
  if (q.jobCardId) params.set('jobCardId', q.jobCardId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useNcRegisterList(
  query: ListNcRegisterQuery,
  options?: Omit<UseQueryOptions<ListNcRegisterResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListNcRegisterResponse>({
    queryKey: ncRegisterKeys.list(query),
    queryFn: () => apiFetch<ListNcRegisterResponse>(`/nc-register?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useNcRegister(id: string | undefined) {
  return useQuery<NcRegister>({
    queryKey: id ? ncRegisterKeys.detail(id) : ncRegisterKeys.detail('__missing__'),
    queryFn: () => apiFetch<NcRegister>(`/nc-register/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateNcRegister() {
  const qc = useQueryClient();
  return useMutation<NcRegister, Error, CreateNcRegisterInput>({
    mutationFn: (input) => apiFetch<NcRegister>('/nc-register', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
      qc.setQueryData(ncRegisterKeys.detail(created.id), created);
    },
  });
}

export function useUpdateNcRegister(id: string) {
  const qc = useQueryClient();
  return useMutation<NcRegister, Error, UpdateNcRegisterInput>({
    mutationFn: (input) =>
      apiFetch<NcRegister>(`/nc-register/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
      qc.setQueryData(ncRegisterKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteNcRegister() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/nc-register/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
      qc.removeQueries({ queryKey: ncRegisterKeys.detail(id) });
    },
  });
}

/** Every cache a QC–NC write can move (design §2–§5): the NC itself, the
 *  parent job card (a child rework/repair JC appears under it, and the op's
 *  NC breakup changes), the op-entry jc-ops rows (pending / at-vendor / NC
 *  columns), and delivery challans (an RTV challan is raised from the NC). */
function useInvalidateNcCascade(id: string) {
  const qc = useQueryClient();
  return (nc: NcRegister) => {
    void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
    void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
    qc.setQueryData(ncRegisterKeys.detail(id), nc);
    void qc.invalidateQueries({ queryKey: jobCardsKeys.all });
    // Prefix of every `opEntryKeys.jcOps(q)` key, whatever the query was.
    void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
    void qc.invalidateQueries({ queryKey: deliveryChallansKeys.all });
  };
}

export function useDisposeNcRegister(id: string) {
  const invalidate = useInvalidateNcCascade(id);
  return useMutation<DisposeNcResult, Error, DisposeNcInput>({
    mutationFn: (input) =>
      apiFetch<DisposeNcResult>(`/nc-register/${id}/dispose`, {
        method: 'POST',
        json: input,
      }),
    // A partial disposition also inserts a sibling NC (design §3), which the
    // list invalidation above picks up; the child JC lands under job-cards.
    onSuccess: (resp) => invalidate(resp.nc),
  });
}

/** Return-to-vendor challan raised straight from the NC (design §5). */
export function useCreateNcDc(id: string) {
  const invalidate = useInvalidateNcCascade(id);
  return useMutation<CreateNcDcResult, Error, CreateNcDcInput>({
    mutationFn: (input) =>
      apiFetch<CreateNcDcResult>(`/nc-register/${id}/create-dc`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (resp) => invalidate(resp.nc),
  });
}

/** Manual close under the closure gate (design §3, interlock 6). The server
 *  answers 409 with the exact shortfall when the gate is not met; the thrown
 *  Error's message is that text, so the page can show it verbatim. */
export function useCloseNc(id: string) {
  const invalidate = useInvalidateNcCascade(id);
  return useMutation<NcRegister, Error, void>({
    mutationFn: () => apiFetch<NcRegister>(`/nc-register/${id}/close`, { method: 'POST' }),
    onSuccess: (updated) => invalidate(updated),
  });
}

export function useCloseNcRework(id: string) {
  const qc = useQueryClient();
  return useMutation<NcRegister, Error, CloseNcReworkInput>({
    mutationFn: (input) =>
      apiFetch<NcRegister>(`/nc-register/${id}/close-rework`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
      qc.setQueryData(ncRegisterKeys.detail(id), updated);
    },
  });
}

/** Replacement received (or the piece written off) on a return-to-vendor NC.
 *  Clears the at-vendor balance the open NC holds against its source op, so the
 *  op-entry / job-card caches have to go too — the op's Pending and At-Vendor
 *  both move (0093). */
export function useCloseNcReturn(id: string) {
  const qc = useQueryClient();
  return useMutation<NcRegister, Error, void>({
    mutationFn: () => apiFetch<NcRegister>(`/nc-register/${id}/close-return`, { method: 'POST' }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.summary() });
      qc.setQueryData(ncRegisterKeys.detail(id), updated);
      void qc.invalidateQueries({ queryKey: ['op-entry'] });
      void qc.invalidateQueries({ queryKey: ['job-cards'] });
    },
  });
}
