// Item + Drawing Rev register (owner model 2026-10-31) — TanStack Query hooks.
//
// "ABC/1" = Item ABC at the customer's Drawing Rev 1 = ONE record holding one
// drawing. The SO line, JWSO line and Route Card forms look it up as soon as
// Item + Rev are both filled (useItemRevisionLookup) so an existing drawing
// fills in by itself; the preview page reads one record with its history and
// linked documents. Contract: packages/shared/src/schemas/item-revision.ts.
//
// CLAUDE.md §22: every key is built from itemRevisionKeys.all; the root is
// declared 'on-open' in REFRESH_POLICY (look-up read when a form/page opens).

import type {
  ItemRevision,
  ItemRevisionChange,
  ItemRevisionDetail,
  ListItemRevisionsQuery,
  ListItemRevisionsResponse,
  LookupItemRevisionResponse,
  ReplaceItemRevisionDrawingInput,
} from '@innovic/shared';
import { REVISION_PATTERN, normalizeRevision } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { activityLogKeys } from '@/modules/activity-log/api';
import { jobWorkOrdersKeys } from '@/modules/job-work-orders/api';
import { routeCardsKeys } from '@/modules/route-cards/api';
import { salesOrdersKeys } from '@/modules/sales-orders/api';

export interface ItemRevisionChangesQuery {
  soLineId?: string;
  jwLineId?: string;
  salesOrderId?: string;
  jobWorkOrderId?: string;
}

export const itemRevisionKeys = {
  all: ['item-revisions'] as const,
  lists: () => [...itemRevisionKeys.all, 'list'] as const,
  list: (q: Partial<ListItemRevisionsQuery>) => [...itemRevisionKeys.lists(), q] as const,
  lookups: () => [...itemRevisionKeys.all, 'lookup'] as const,
  lookup: (itemId: string, rev: string) => [...itemRevisionKeys.lookups(), itemId, rev] as const,
  details: () => [...itemRevisionKeys.all, 'detail'] as const,
  detail: (id: string) => [...itemRevisionKeys.details(), id] as const,
  changes: (q: ItemRevisionChangesQuery) => [...itemRevisionKeys.all, 'changes', q] as const,
};

/** The Rev as the server will store it ("b " → "B"), or '' when it is not a
 *  valid Drawing Rev yet — a half-typed value is never sent to the look-up. */
export function cleanDrawingRev(raw: string | null | undefined): string {
  const r = normalizeRevision(raw ?? '');
  return REVISION_PATTERN.test(r) ? r : '';
}

/** Follows `value` after it has been still for `ms` — so typing "12" asks for
 *  ABC/12 once, not ABC/1 then ABC/12. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** GET /item-revisions/lookup — does ABC/<rev> exist, and with which drawing?
 *  Runs only when BOTH an item and a valid Rev are filled. `revRequired`
 *  answers whether the item takes a Rev at all (make items only). */
export function useItemRevisionLookup(
  itemId: string | null | undefined,
  rev: string | null | undefined,
) {
  const cleaned = useDebounced(cleanDrawingRev(rev), 300);
  const id = itemId ?? '';
  return useQuery<LookupItemRevisionResponse>({
    queryKey: itemRevisionKeys.lookup(id, cleaned),
    queryFn: () => {
      const p = new URLSearchParams({ itemId: id, rev: cleaned });
      return apiFetch<LookupItemRevisionResponse>(`/item-revisions/lookup?${p.toString()}`);
    },
    enabled: Boolean(id && cleaned),
  });
}

/** GET /item-revisions — every Rev of one item, or a search across all. */
export function useItemRevisions(
  q: Partial<ListItemRevisionsQuery>,
  options?: { enabled?: boolean },
) {
  return useQuery<ListItemRevisionsResponse>({
    queryKey: itemRevisionKeys.list(q),
    queryFn: () => {
      const p = new URLSearchParams();
      if (q.itemId) p.set('itemId', q.itemId);
      if (q.search) p.set('search', q.search);
      p.set('limit', String(q.limit ?? 50));
      p.set('offset', String(q.offset ?? 0));
      return apiFetch<ListItemRevisionsResponse>(`/item-revisions?${p.toString()}`);
    },
    placeholderData: (prev) => prev,
    ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

/** GET /item-revisions/:id — one record with its drawing history and the
 *  documents that name it. */
export function useItemRevision(id: string | undefined) {
  return useQuery<ItemRevisionDetail>({
    queryKey: itemRevisionKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<ItemRevisionDetail>(`/item-revisions/${id}`),
    enabled: Boolean(id),
  });
}

/** GET /item-revisions/changes — Rev changes on one line or one order. */
export function useItemRevisionChanges(q: ItemRevisionChangesQuery) {
  const p = new URLSearchParams();
  if (q.soLineId) p.set('soLineId', q.soLineId);
  if (q.jwLineId) p.set('jwLineId', q.jwLineId);
  if (q.salesOrderId) p.set('salesOrderId', q.salesOrderId);
  if (q.jobWorkOrderId) p.set('jobWorkOrderId', q.jobWorkOrderId);
  const qs = p.toString();
  return useQuery<ItemRevisionChange[]>({
    queryKey: itemRevisionKeys.changes(q),
    queryFn: () => apiFetch<ItemRevisionChange[]>(`/item-revisions/changes?${qs}`),
    enabled: qs.length > 0,
  });
}

/** POST /item-revisions/:id/replace-drawing — the ONLY way to change the file
 *  of an Item + Rev that already has one. Reason compulsory; 409 when someone
 *  changed the record since it was loaded (expectedUpdatedAt). */
export function useReplaceItemRevisionDrawing(id: string) {
  const qc = useQueryClient();
  return useMutation<ItemRevision, Error, ReplaceItemRevisionDrawingInput>({
    mutationFn: (input) =>
      apiFetch<ItemRevision>(`/item-revisions/${id}/replace-drawing`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      // The register itself, and every screen that shows this Item + Rev's
      // drawing: Route Cards and SO / JWSO lines carry the file path too.
      void qc.invalidateQueries({ queryKey: itemRevisionKeys.all });
      void qc.invalidateQueries({ queryKey: routeCardsKeys.all });
      void qc.invalidateQueries({ queryKey: salesOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: jobWorkOrdersKeys.all });
      void qc.invalidateQueries({ queryKey: activityLogKeys.all });
    },
  });
}
