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

/** ADR-203 — per JWSO line, the pieces received on Party GRNs that are still
 *  waiting for Incoming QC (same rule as the server's PENDING_QC_SQL: qcAt null
 *  and nothing accepted or rejected yet). The receipt cap is
 *  Pending = order qty − (accepted + waiting QC), and the JWSO line only
 *  carries the accepted figure, so this supplies the other half.
 *  Only the GRNs of that JWSO with a line still waiting are opened. */
export function usePartyGrnWaitingQcByJwLine(jobWorkOrderId: string | null) {
  return useQuery<Map<string, number>>({
    queryKey: partyGrnKeys.waitingQc(jobWorkOrderId ?? ''),
    enabled: Boolean(jobWorkOrderId),
    staleTime: 0,
    queryFn: async () => {
      const waiting = new Map<string, number>();
      if (!jobWorkOrderId) return waiting;
      const grnIds: string[] = [];
      const limit = 200;
      for (let offset = 0; ; offset += limit) {
        const page: ListPartyGrnResponse = await apiFetch<ListPartyGrnResponse>(
          `/party-grn?${buildSearch({ jobWorkOrderId, limit, offset })}`,
        );
        for (const g of page.items) {
          if (g.jobWorkOrderId === jobWorkOrderId && g.qcPendingLines > 0) grnIds.push(g.id);
        }
        if (page.items.length < limit || offset + limit >= page.total) break;
      }
      const details = await Promise.all(
        grnIds.map((id) => apiFetch<PartyGrnDetail>(`/party-grn/${id}`)),
      );
      for (const d of details) {
        for (const l of d.lines) {
          if (!l.jwLineId || l.deletedAt) continue;
          if (l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0) {
            waiting.set(l.jwLineId, (waiting.get(l.jwLineId) ?? 0) + l.receivedQty);
          }
        }
      }
      return waiting;
    },
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
