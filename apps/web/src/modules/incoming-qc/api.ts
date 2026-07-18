import type { IncomingQcResponse, SubmitIncomingQcInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const incomingQcKeys = {
  all: ['incoming-qc'] as const,
};

export function useIncomingQc() {
  return useQuery<IncomingQcResponse>({
    queryKey: incomingQcKeys.all,
    queryFn: () => apiFetch<IncomingQcResponse>('/incoming-qc'),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Inline accept/reject for one GRN line (Incoming QC Call Register). Refreshes
 *  the queue (and GRN/PO/stock views) on success. */
export function useSubmitIncomingQc() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; grnId: string },
    Error,
    { grnLineId: string; input: SubmitIncomingQcInput }
  >({
    mutationFn: ({ grnLineId, input }) =>
      apiFetch<{ ok: true; grnId: string }>(`/incoming-qc/${grnLineId}/inspect`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: incomingQcKeys.all });
      void qc.invalidateQueries({ queryKey: ['goods-receipt-notes'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
    },
  });
}
