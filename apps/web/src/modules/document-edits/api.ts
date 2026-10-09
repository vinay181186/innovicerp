// Edit-approval (ADR-202) — TanStack Query hooks for the staged-edit feature.
//
// Three endpoints, all under /document-edits:
//   GET  /document-edits                 — the inbox list + the per-document
//                                          pending lookup (entity + entityId)
//   POST /document-edits/:id/decide      — per-change approve / reject (1A)
//   POST /document-edits/:id/withdraw    — the requester pulls an edit back
//
// A decision or a withdrawal changes what is waiting AND may apply changes to
// the PO, so on success we refresh: the inbox lists, the document History
// (activity log, ADR-197) and the PO detail + list caches.

import type {
  DecideDocumentEditInput,
  DocumentEditCountsResponse,
  DocumentEditEntity,
  DocumentEditStagedResult,
  ListDocumentEditsQuery,
  ListDocumentEditsResponse,
  WithdrawDocumentEditInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';
import { purchaseOrdersKeys } from '@/modules/purchase-orders/api';

export const documentEditsKeys = {
  all: ['document-edits'] as const,
  lists: () => [...documentEditsKeys.all, 'list'] as const,
  list: (q: ListDocumentEditsQuery) => [...documentEditsKeys.lists(), q] as const,
  /** Pending edits for one document — the inline chip on the PO detail. */
  pending: (entity: DocumentEditEntity, entityId: string) =>
    [...documentEditsKeys.all, 'pending', entity, entityId] as const,
  /** Pending count per document type — the Approvals page's dynamic tab row. */
  counts: () => [...documentEditsKeys.all, 'counts'] as const,
};

function toQueryString(query: ListDocumentEditsQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return params.toString();
}

/** The Edit Approvals inbox list — and anywhere else a filtered set of staged
 *  edits is needed. Lives on the app's standard live pattern (auto-refresh on an
 *  interval + on window focus) so a decision made elsewhere shows up without a
 *  manual reload. */
export function useDocumentEdits(query: ListDocumentEditsQuery) {
  return useQuery<ListDocumentEditsResponse>({
    queryKey: documentEditsKeys.list(query),
    queryFn: () => apiFetch<ListDocumentEditsResponse>(`/document-edits?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Pending edit-request count per document type (GET /document-edits/counts).
 *  Only document types with pending > 0 are returned, so it drives the Approvals
 *  page's dynamic tab row (one tab per document that needs attention) and each
 *  tab's badge. On the app's standard live pattern so the tab row keeps itself
 *  current while the page is open. */
export function useDocumentEditCounts(opts: { enabled?: boolean } = {}) {
  return useQuery<DocumentEditCountsResponse>({
    queryKey: documentEditsKeys.counts(),
    queryFn: () => apiFetch<DocumentEditCountsResponse>('/document-edits/counts'),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Total pending edits across every document type — folded into the Approvals
 *  nav badge so a waiting edit raises it, same as a waiting PR / PO / Op Entry. */
export function useDocumentEditPendingTotal(enabled: boolean): number {
  const q = useDocumentEditCounts({ enabled });
  return (q.data?.counts ?? []).reduce((sum, c) => sum + c.pending, 0);
}

/** The set of document ids of ONE entity type that have a pending edit — feeds
 *  the "Draft" overlay on that entity's LIST (one fetch, not one-per-row). On the
 *  standard live pattern so a decision elsewhere clears the Draft within a cycle.
 *  Capped at 200 pending (an approval queue is never larger in practice). */
export function usePendingEditIds(entity: DocumentEditEntity, enabled = true): Set<string> {
  const q = useQuery<ListDocumentEditsResponse>({
    queryKey: [...documentEditsKeys.all, 'pending-ids', entity] as const,
    queryFn: () =>
      apiFetch<ListDocumentEditsResponse>(
        `/document-edits?${toQueryString({ entity, status: 'pending', limit: 200 })}`,
      ),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  return useMemo(() => new Set((q.data?.rows ?? []).map((r) => r.entityId)), [q.data]);
}

/** The pending edit (if any) for ONE document — feeds the PO detail inline
 *  chip. Keyed by entity + entityId so it refreshes when a decision lands. */
export function usePendingEditForDoc(
  entity: DocumentEditEntity,
  entityId: string | undefined,
) {
  return useQuery<ListDocumentEditsResponse>({
    queryKey: entityId
      ? documentEditsKeys.pending(entity, entityId)
      : documentEditsKeys.pending(entity, '__missing__'),
    queryFn: () =>
      apiFetch<ListDocumentEditsResponse>(
        `/document-edits?${toQueryString({ entity, entityId: entityId as string, status: 'pending' })}`,
      ),
    enabled: Boolean(entityId),
    staleTime: 30_000,
  });
}

/** Everything that changed once a request is decided or withdrawn: the inbox
 *  lists, the per-document pending lookups, the document History and the PO
 *  caches (a decision may have applied approved changes to the PO). */
function useRefreshAfterChange(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: documentEditsKeys.all });
    void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all });
  };
}

/** Per-change approve / reject (1A). A reject needs a reason — enforced by the
 *  shared schema and by the reason dialog in the inbox. */
export function useDecideDocumentEdit() {
  const refresh = useRefreshAfterChange();
  return useMutation<void, Error, DecideDocumentEditInput>({
    mutationFn: async (input) => {
      await apiFetch<unknown>(`/document-edits/${input.id}/decide`, {
        method: 'POST',
        json: input,
      });
    },
    onSuccess: refresh,
  });
}

/** The requester pulls a staged edit back before it is decided. */
export function useWithdrawDocumentEdit() {
  const refresh = useRefreshAfterChange();
  return useMutation<void, Error, WithdrawDocumentEditInput>({
    mutationFn: async (input) => {
      await apiFetch<unknown>(`/document-edits/${input.id}/withdraw`, {
        method: 'POST',
        json: input,
      });
    },
    onSuccess: refresh,
  });
}

/** Narrow a PO PATCH response: true when the edit was staged for approval
 *  instead of applied (the gate is on and the document is live). */
export function isStagedResult(
  result: unknown,
): result is DocumentEditStagedResult {
  return typeof result === 'object' && result !== null && 'staged' in result;
}
