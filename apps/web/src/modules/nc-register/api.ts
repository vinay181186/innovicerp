import type {
  CloseNcReworkInput,
  CreateNcRegisterInput,
  DisposeNcInput,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  UpdateNcRegisterInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const ncRegisterKeys = {
  all: ['nc-register'] as const,
  lists: () => [...ncRegisterKeys.all, 'list'] as const,
  list: (q: ListNcRegisterQuery) => [...ncRegisterKeys.lists(), q] as const,
  details: () => [...ncRegisterKeys.all, 'detail'] as const,
  detail: (id: string) => [...ncRegisterKeys.details(), id] as const,
};

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
      qc.removeQueries({ queryKey: ncRegisterKeys.detail(id) });
    },
  });
}

interface DisposeResponse {
  result: {
    ncId: string;
    status: 'disposed' | 'closed';
    reworkOpId?: string;
    reworkOpSeqApplied?: number;
    newJcCode?: string;
    newJcId?: string;
    opLogId?: string;
  };
  nc: NcRegister;
}

export function useDisposeNcRegister(id: string) {
  const qc = useQueryClient();
  return useMutation<DisposeResponse, Error, DisposeNcInput>({
    mutationFn: (input) =>
      apiFetch<DisposeResponse>(`/nc-register/${id}/dispose`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      qc.setQueryData(ncRegisterKeys.detail(id), resp.nc);
      // Cascade fanout: rework bumps jc_ops.rework_qty (op-entry caches);
      // make_fresh creates a new JC (job-cards caches); use_as_is appends
      // an op_log row.
      void qc.invalidateQueries({ queryKey: ['op-entry'] });
      void qc.invalidateQueries({ queryKey: ['job-cards'] });
    },
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
      qc.setQueryData(ncRegisterKeys.detail(id), updated);
    },
  });
}
