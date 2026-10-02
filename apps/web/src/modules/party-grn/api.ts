import type {
  CreatePartyGrnInput,
  ListPartyGrnQuery,
  ListPartyGrnResponse,
  PartyGrn,
  PartyGrnDetail,
  PartyGrnQcInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';

export const partyGrnKeys = {
  all: ['party-grn'] as const,
  list: (q: ListPartyGrnQuery) =>
    [
      ...partyGrnKeys.all,
      'list',
      q.search ?? null,
      q.jobWorkOrderId ?? null,
      q.clientId ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...partyGrnKeys.all, 'detail', id] as const,
  nextCode: () => [...partyGrnKeys.all, 'next-code'] as const,
  waitingQc: (jobWorkOrderId: string) =>
    [...partyGrnKeys.all, 'waiting-qc', jobWorkOrderId] as const,
};

function buildSearch(q: ListPartyGrnQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.jobWorkOrderId) params.set('jobWorkOrderId', q.jobWorkOrderId);
  if (q.clientId) params.set('clientId', q.clientId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function usePartyGrnList(query: ListPartyGrnQuery) {
  return useQuery<ListPartyGrnResponse>({
    queryKey: partyGrnKeys.list(query),
    queryFn: () => apiFetch<ListPartyGrnResponse>(`/party-grn?${buildSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function usePartyGrnDetail(id: string | undefined) {
  return useQuery<PartyGrnDetail>({
    queryKey: partyGrnKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<PartyGrnDetail>(`/party-grn/${id}`),
    enabled: Boolean(id),
  });
}

export function useNextPartyGrnCode() {
  return useQuery<{ code: string }>({
    queryKey: partyGrnKeys.nextCode(),
    queryFn: () => apiFetch<{ code: string }>('/party-grn/next-code'),
    staleTime: 0,
  });
}

export function useCreatePartyGrn(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<PartyGrn, Error, CreatePartyGrnInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<PartyGrn>('/party-grn', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Party material stocks changed
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
    },
  });
}

/** ADR-102 — reverse a wrong receipt. Credits the qty back off party stock. */
export function useCancelPartyGrn() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; code: string; reversedQty: number },
    Error,
    { id: string; reason: string }
  >({
    mutationFn: ({ id, reason }) =>
      apiFetch<{ ok: true; code: string; reversedQty: number }>(`/party-grn/${id}/cancel`, {
        method: 'POST',
        json: { reason },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
    },
  });
}

/** ADR-203 (owner D4): Incoming QC on a Party GRN — a separate step after the
 *  receipt, gated by qc_incoming · entry. Only the accepted qty enters the
 *  customer-material register. */
export function useQcPartyGrn() {
  const qc = useQueryClient();
  return useMutation<PartyGrnDetail, Error, { id: string } & PartyGrnQcInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<PartyGrnDetail>(`/party-grn/${id}/qc`, { method: 'POST', json: body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: partyGrnKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
      // Accepted qty enters the register; JWSO lines show rmAcceptedQty.
      void qc.invalidateQueries({ queryKey: ['party-materials'] });
      void qc.invalidateQueries({ queryKey: ['party-stock-ledger'] });
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
