// Production Order query hooks (ADR-170, migration 0133).
//
// A Production Order is the ONE document that turns a route-card-driven plan
// into a Job Card: Plan + Route Card + Target Date → Create JC. Closing it
// (blocked until the JC is complete) credits stock ONCE with the JC's actually
// finished qty. Wire shapes: packages/shared/src/schemas/production-order.ts.
//
// Cache shape follows tpi-masters/api.ts (key factory + list/detail/create).
// Create and Close both touch neighbours — the plan gains a PO (its derived
// status moves), a Job Card is born / closed, the SO's planning summary shows
// the PO code — so those caches are invalidated here rather than left stale.

import type {
  CloseProductionOrderInput,
  CreateProductionOrderInput,
  ListPlansQuery,
  ListPlansResponse,
  ListProductionOrdersQuery,
  ListProductionOrdersResponse,
  NextProductionOrderCodeResponse,
  ProductionOrderDetail,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { plansKeys } from '@/modules/plans/api';
import { soPlanningKeys } from '@/modules/so-planning/api';

export const productionOrdersKeys = {
  all: ['production-orders'] as const,
  lists: () => [...productionOrdersKeys.all, 'list'] as const,
  list: (q: ListProductionOrdersQuery) => [...productionOrdersKeys.lists(), q] as const,
  details: () => [...productionOrdersKeys.all, 'detail'] as const,
  detail: (id: string) => [...productionOrdersKeys.details(), id] as const,
  nextCode: () => [...productionOrdersKeys.all, 'next-code'] as const,
};

function toQueryString(q: ListProductionOrdersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.planId) params.set('planId', q.planId);
  if (q.jobCardId) params.set('jobCardId', q.jobCardId);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useProductionOrdersList(
  query: ListProductionOrdersQuery,
  options?: Omit<UseQueryOptions<ListProductionOrdersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListProductionOrdersResponse>({
    queryKey: productionOrdersKeys.list(query),
    queryFn: () =>
      apiFetch<ListProductionOrdersResponse>(`/production-orders?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useProductionOrder(id: string | undefined) {
  return useQuery<ProductionOrderDetail>({
    queryKey: id ? productionOrdersKeys.detail(id) : productionOrdersKeys.detail('__missing__'),
    queryFn: () => apiFetch<ProductionOrderDetail>(`/production-orders/${id}`),
    enabled: Boolean(id),
  });
}

/** Read-only "PO No" preview on the Create screen. staleTime 0 so a second
 *  visit after someone else created one shows the true next number. */
export function useNextProductionOrderCode(enabled = true) {
  return useQuery<NextProductionOrderCodeResponse>({
    queryKey: productionOrdersKeys.nextCode(),
    queryFn: () => apiFetch<NextProductionOrderCodeResponse>('/production-orders/next-code'),
    enabled,
    staleTime: 0,
  });
}

/** Everything a Create / Close changes elsewhere in the app: the plan's
 *  derived status + PO code (plans lists, SO planning detail), the Job Card
 *  (born on create, closed on close) and this module's own lists. */
function invalidateNeighbours(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: productionOrdersKeys.lists() });
  void qc.invalidateQueries({ queryKey: productionOrdersKeys.nextCode() });
  void qc.invalidateQueries({ queryKey: plansKeys.all });
  void qc.invalidateQueries({ queryKey: jobCardsKeys.all });
  void qc.invalidateQueries({ queryKey: soPlanningKeys.all });
}

export function useCreateProductionOrder() {
  const qc = useQueryClient();
  return useMutation<ProductionOrderDetail, Error, CreateProductionOrderInput>({
    mutationFn: (input) =>
      apiFetch<ProductionOrderDetail>('/production-orders', { method: 'POST', json: input }),
    onSuccess: (created) => {
      invalidateNeighbours(qc);
      qc.setQueryData(productionOrdersKeys.detail(created.id), created);
    },
  });
}

export function useCloseProductionOrder() {
  const qc = useQueryClient();
  return useMutation<
    ProductionOrderDetail,
    Error,
    { id: string; input?: CloseProductionOrderInput }
  >({
    mutationFn: ({ id, input }) =>
      apiFetch<ProductionOrderDetail>(`/production-orders/${id}/close`, {
        method: 'POST',
        json: input ?? {},
      }),
    onSuccess: (closed) => {
      invalidateNeighbours(qc);
      // Close credits stock — the store screens read the same item.
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      qc.setQueryData(productionOrdersKeys.detail(closed.id), closed);
    },
  });
}

// ─── Plan picker ─────────────────────────────────────────────────────────
//
// The Create screen lists only route-card-driven plans that have no Production
// Order yet (`poPending=true`); the Close screen lists route-card-driven plans
// (`opsSource=route_card`) and keeps the ones that DO have one. Both are the
// `/plans` list endpoint with the two new query params from
// listPlansQuerySchema. It is a hook of its own (not plans/api.ts
// `usePlansList`) because that builder does not yet send `opsSource` /
// `poPending` — the plans module is being reworked in parallel — and a picker
// that silently listed every old plan would let a user raise a PO against one.
// Keyed under `plansKeys.all` so the invalidations above still refresh it.

export type PlanPickerItem = ListPlansResponse['items'][number];

export type PlanPickerQuery = Pick<
  ListPlansQuery,
  'search' | 'opsSource' | 'poPending' | 'derivedStatus' | 'limit' | 'offset'
>;

function toPlanPickerQueryString(q: PlanPickerQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.opsSource) params.set('opsSource', q.opsSource);
  if (q.derivedStatus) params.set('derivedStatus', q.derivedStatus);
  if (q.poPending !== undefined) params.set('poPending', String(q.poPending));
  params.set('limit', String(q.limit ?? 50));
  params.set('offset', String(q.offset ?? 0));
  return params.toString();
}

export function usePlanPickerList(query: PlanPickerQuery, enabled = true) {
  return useQuery<ListPlansResponse>({
    queryKey: [...plansKeys.all, 'list', 'po-picker', query] as const,
    queryFn: () => apiFetch<ListPlansResponse>(`/plans?${toPlanPickerQueryString(query)}`),
    placeholderData: (prev) => prev,
    enabled,
  });
}

/** "PLN-0007 — ITEM-CODE — item name — qty 50 — SO IN-SO-00024/2" */
export function planPickerLabel(p: PlanPickerItem): string {
  const item = p.itemCode ?? p.itemCodeText ?? '—';
  const name = p.itemName ?? p.itemNameText ?? '';
  const so = p.soCodeText ? `${p.soCodeText}${p.lineNo ? `/${p.lineNo}` : ''}` : '—';
  return [p.code, item, name, `qty ${p.planQty}`, `SO ${so}`].filter(Boolean).join(' — ');
}
