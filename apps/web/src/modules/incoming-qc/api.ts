import type { IncomingQcQuery, IncomingQcResponse, SubmitIncomingQcInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';

export const incomingQcKeys = {
  all: ['incoming-qc'] as const,
  view: (q: IncomingQcQuery) => [...incomingQcKeys.all, q] as const,
};

function toQueryString(q: IncomingQcQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * GET /incoming-qc. With no params: every pending line + the 20 most recent
 * completed (the QC Call Register's read). The Incoming QC screen passes
 * search + a 25-row page per table + each table's Sort & Filter (ADR-201).
 * `keepPrevious` (default on) shows the old page while the next one loads —
 * off for a one-line read, which must never show another line's figures.
 */
export function useIncomingQc(
  query: IncomingQcQuery = {},
  opts: { enabled?: boolean; keepPrevious?: boolean } = {},
) {
  return useQuery<IncomingQcResponse>({
    queryKey: incomingQcKeys.view(query),
    queryFn: () => apiFetch<IncomingQcResponse>(`/incoming-qc${toQueryString(query)}`),
    refetchInterval: 30_000,
    enabled: opts.enabled ?? true,
    ...(opts.keepPrevious === false
      ? {}
      : { placeholderData: (prev?: IncomingQcResponse) => prev }),
  });
}

/** Inline accept/reject for one GRN line (Incoming QC Call Register). Refreshes
 *  the queue (and GRN/PO/stock views) on success. */
export function useSubmitIncomingQc() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true; grnId: string; raisedNc: { id: string; code: string } | null },
    Error,
    { grnLineId: string; input: SubmitIncomingQcInput }
  >({
    mutationFn: ({ grnLineId, input }) =>
      apiFetch<{ ok: true; grnId: string; raisedNc: { id: string; code: string } | null }>(
        `/incoming-qc/${grnLineId}/inspect`,
        {
          method: 'POST',
          json: input,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: incomingQcKeys.all });
      void qc.invalidateQueries({ queryKey: ['goods-receipt-notes'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      // A reject raises an NC — the NC Register must show it.
      void qc.invalidateQueries({ queryKey: ['nc-register'] });
      // The inspection is a QC row on the GRN's History (ADR-197).
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
