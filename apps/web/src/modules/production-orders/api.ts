// Production Order query hooks (ADR-170, migration 0133).
//
// A Production Order is the ONE document that turns a route-card-driven plan
// into a Job Card: Plan + Route Card + Customer Dispatch Date (the `targetDate`
// field on the wire) → Create JC. Closing it
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
  JobCardListItem,
  ListPlansQuery,
  ListPlansResponse,
  ListProductionOrdersQuery,
  ListProductionOrdersResponse,
  NextProductionOrderCodeResponse,
  ProductionOrderDetail,
  ProductionOrderListItem,
  ReverseProductionOrderCloseInput,
  ShortCloseProductionOrderInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { itemCodeWithRev } from '@/lib/item-code';
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
  /** "which order built this Job Card" — one entry per Job Card id. */
  forJobCards: () => [...productionOrdersKeys.all, 'for-job-card'] as const,
  forJobCard: (jobCardId: string) => [...productionOrdersKeys.forJobCards(), jobCardId] as const,
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

/** How far up the rework / repair chain we look for the order. Same cap as the
 *  server-side walk in `apps/api/src/lib/production-order-link.ts`. */
const PARENT_JOB_CARD_HOPS = 10;

/**
 * The Production Order that built a given Job Card, or null when no order did
 * (a hand-raised JC or a pre-ADR-170 card).
 *
 * It walks UP the rework / repair chain, exactly as the server-side guard does
 * (`apps/api/src/lib/production-order-link.ts`): a recovery child carries no
 * `production_order_id` of its own, so asking only for the child's own order
 * answers "none" and the page would treat a frozen card as a live one. That is
 * the case the stop guard goes to the trouble of resolving, so the screen has
 * to resolve it too — otherwise the child of a short-closed order shows no
 * banner, offers Start / Log / QC Call / NC, and the server refuses the click
 * with nothing on the page to explain why.
 *
 * ADR-182: the Job Card page reads this to know whether its order was SHORT
 * CLOSED (a stopped order freezes the card) and to show the `Actual Size` the
 * store really cut, which the Job Card wire shape does not carry.
 *
 * Cost on an ordinary card is one request: the first lookup hits and the walk
 * stops. Only a card with no order of its own reads its own Job Card to find a
 * parent, and that read comes out of the cache the page has already filled.
 */
export function useProductionOrderForJobCard(jobCardId: string | undefined, enabled = true) {
  const qc = useQueryClient();
  const q = useQuery<ProductionOrderListItem | null>({
    queryKey: productionOrdersKeys.forJobCard(jobCardId ?? '__missing__'),
    queryFn: async () => {
      let next: string | null = jobCardId ?? null;
      for (let hop = 0; hop < PARENT_JOB_CARD_HOPS && next; hop += 1) {
        const cardId: string = next;
        const query: ListProductionOrdersQuery = { limit: 1, offset: 0, jobCardId: cardId };
        const res = await apiFetch<ListProductionOrdersResponse>(
          `/production-orders?${toQueryString(query)}`,
        );
        const hit = res.items[0];
        if (hit) return hit;
        // No order on this card — step up to its parent. `fetchQuery` reuses
        // the Job Card the page already loaded rather than fetching it twice.
        const card = await qc.fetchQuery<JobCardListItem>({
          queryKey: jobCardsKeys.detail(cardId),
          queryFn: () => apiFetch<JobCardListItem>(`/job-cards/${cardId}`),
        });
        next = card.parentJobCardId;
      }
      return null;
    },
    enabled: enabled && Boolean(jobCardId),
  });
  return { order: q.data ?? null, isLoading: q.isLoading };
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
  void qc.invalidateQueries({ queryKey: productionOrdersKeys.forJobCards() });
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
    // ADR-179: partial/progressive close. `input` carries { qty?, finish?,
    // remarks? }; omitting qty closes everything currently available.
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
      // The detail carries the running ledger + credited/remaining, so replace
      // it wholesale, then refresh the detail query so the ledger is authoritative.
      qc.setQueryData(productionOrdersKeys.detail(closed.id), closed);
      void qc.invalidateQueries({ queryKey: productionOrdersKeys.detail(closed.id) });
    },
  });
}

/**
 * ADR-182 Short Close — stop the order at ANY stage. NOT the "close short"
 * above: nothing is credited and nothing is written off, the order and its Job
 * Card are simply frozen and the un-produced qty goes back to the plan's
 * Pending, so the plan can be ordered again.
 *
 * Invalidates the same neighbours a Create / Close does — the plan's Covered /
 * Pending and derived status both move, and the Job Card page reads the order's
 * status to decide whether to show its work buttons.
 */
export function useShortCloseProductionOrder() {
  const qc = useQueryClient();
  return useMutation<
    ProductionOrderDetail,
    Error,
    { id: string; input: ShortCloseProductionOrderInput }
  >({
    mutationFn: ({ id, input }) =>
      apiFetch<ProductionOrderDetail>(`/production-orders/${id}/short-close`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (updated) => {
      invalidateNeighbours(qc);
      qc.setQueryData(productionOrdersKeys.detail(updated.id), updated);
      void qc.invalidateQueries({ queryKey: productionOrdersKeys.detail(updated.id) });
    },
  });
}

/** Undo one close-ledger row (ADR-179): writes a compensating stock-out +
 *  reversal row and lowers credited_qty. The server refuses when the pieces
 *  have already been dispatched — that error flows back through onError so the
 *  caller can surface it. Invalidates the PO detail + list + store caches. */
export function useReverseProductionOrderClose() {
  const qc = useQueryClient();
  return useMutation<
    ProductionOrderDetail,
    Error,
    { id: string; input: ReverseProductionOrderCloseInput }
  >({
    mutationFn: ({ id, input }) =>
      apiFetch<ProductionOrderDetail>(`/production-orders/${id}/reverse-close`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: (updated) => {
      invalidateNeighbours(qc);
      // A reversal removes stock — the store screens read the same item.
      void qc.invalidateQueries({ queryKey: ['store-inventory'] });
      void qc.invalidateQueries({ queryKey: ['store-transactions'] });
      qc.setQueryData(productionOrdersKeys.detail(updated.id), updated);
      void qc.invalidateQueries({ queryKey: productionOrdersKeys.detail(updated.id) });
    },
  });
}

// ─── Plan picker ─────────────────────────────────────────────────────────
//
// The Create screen lists route-card-driven plans that still have qty left to
// order — `poPending=true`, which since ADR-182 means "Pending > 0" rather than
// "has no Production Order at all", so a plan 20-covered of 50 is still
// offered for the other 30; the Close screen lists route-card-driven plans
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

/** The plan a deep link named (?planId=&planCode=), in picker-row shape, or
 *  null while loading / when it is not (or no longer) in the wanted state.
 *  Searches by CODE so the answer is one page, then matches the id — the
 *  Plans list's "+ Create / Close Production Order" buttons arrive this way. */
export function usePreselectedPlan(
  planId: string | undefined,
  planCode: string | undefined,
  mode: 'create' | 'close',
): PlanPickerItem | null {
  const q = usePlanPickerList(
    {
      ...(mode === 'create' ? { poPending: true } : { derivedStatus: 'in_production' }),
      ...(planCode ? { search: planCode } : {}),
      limit: 50,
      offset: 0,
    },
    Boolean(planId),
  );
  return planId ? (q.data?.items.find((p) => p.id === planId) ?? null) : null;
}

/**
 * One picker row as one line:
 *
 *   "PLN-0007 — POL 20 — ITEM-CODE/B — item name — Plan Qty 50 · Pending 30 — SO IN-SO-00024/2"
 *
 * ADR-182: on the CREATE screen a plan may already be part-covered by earlier
 * Production Orders, so the row says how much is still `Pending` (NAMING.md —
 * never "Remaining" or "Balance") beside its `Plan Qty`. The Close screen has
 * no such question and keeps the plain Plan Qty.
 */
export function planPickerLabel(p: PlanPickerItem, mode: 'create' | 'close' = 'close'): string {
  // CODE/REV so the picker agrees with the PlanSummary under it (ADR-177).
  const item = itemCodeWithRev(p.itemCode ?? p.itemCodeText, p.itemRevision);
  const name = p.itemName ?? p.itemNameText ?? '';
  const so = p.soCodeText ? `${p.soCodeText}${p.lineNo ? `/${p.lineNo}` : ''}` : '—';
  // POL — the line number printed on the CUSTOMER's own purchase order, ahead
  // of the item code. NOT the `/n` in the SO part, which is OUR line number.
  const pol = p.clientPoLineNo ? `POL ${p.clientPoLineNo}` : '';
  const qty =
    mode === 'create' ? `Plan Qty ${p.planQty} · Pending ${p.pendingQty}` : `Plan Qty ${p.planQty}`;
  return [p.code, pol, item, name, qty, `SO ${so}`].filter(Boolean).join(' — ');
}
