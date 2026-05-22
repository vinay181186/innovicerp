import type {
  CreatePlanInput,
  ExecutePlanResultShape,
  ListPlansQuery,
  ListPlansResponse,
  PlanDetail,
  PlanOpInput,
  PlanningDashboardResponse,
  UnplannedOrdersResponse,
  UpdatePlanInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const plansKeys = {
  all: ['plans'] as const,
  list: (q: ListPlansQuery) =>
    [...plansKeys.all, 'list', q.status ?? null, q.planType ?? null, q.search ?? null, q.limit, q.offset] as const,
  detail: (id: string) => [...plansKeys.all, 'detail', id] as const,
  dashboard: () => [...plansKeys.all, 'dashboard'] as const,
  defaultOps: (itemId: string | null) => [...plansKeys.all, 'default-ops', itemId] as const,
};

function buildPlansSearch(q: ListPlansQuery): string {
  const params = new URLSearchParams();
  if (q.status) params.set('status', q.status);
  if (q.planType) params.set('planType', q.planType);
  if (q.search) params.set('search', q.search);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  if (q.offset !== undefined) params.set('offset', String(q.offset));
  const s = params.toString();
  return s.length > 0 ? `?${s}` : '';
}

export function usePlansList(query: ListPlansQuery) {
  return useQuery<ListPlansResponse>({
    queryKey: plansKeys.list(query),
    queryFn: () => apiFetch<ListPlansResponse>(`/plans${buildPlansSearch(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function usePlan(id: string) {
  return useQuery<PlanDetail>({
    queryKey: plansKeys.detail(id),
    queryFn: () => apiFetch<PlanDetail>(`/plans/${id}`),
  });
}

export function usePlanningDashboard() {
  return useQuery<PlanningDashboardResponse>({
    queryKey: plansKeys.dashboard(),
    queryFn: () => apiFetch<PlanningDashboardResponse>('/planning-dashboard'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

// PL-3b — Needs Planning tile data. Only fetched when the user clicks the
// "Needs Planning" tile (gate via `enabled` in the caller).
export function useUnplannedOrders(enabled: boolean) {
  return useQuery<UnplannedOrdersResponse>({
    queryKey: [...plansKeys.all, 'unplanned'] as const,
    queryFn: () => apiFetch<UnplannedOrdersResponse>('/planning-dashboard/unplanned'),
    enabled,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePlanInput) =>
      apiFetch<PlanDetail>('/plans', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: plansKeys.all });
    },
  });
}

export function useUpdatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePlanInput) =>
      apiFetch<PlanDetail>(`/plans/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: plansKeys.all });
    },
  });
}

export function useFinalizePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<PlanDetail>(`/plans/${id}/finalize`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: plansKeys.all });
    },
  });
}

export function useExecutePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ExecutePlanResultShape>(`/plans/${id}/execute`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: plansKeys.all });
    },
  });
}

export function useSoftDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/plans/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: plansKeys.all });
    },
  });
}

export function useDefaultRouteOps(itemId: string | null) {
  return useQuery<{ ops: PlanOpInput[] }>({
    queryKey: plansKeys.defaultOps(itemId),
    queryFn: () =>
      apiFetch<{ ops: PlanOpInput[] }>(
        `/plans/default-ops?itemId=${encodeURIComponent(itemId!)}`,
      ),
    enabled: !!itemId,
  });
}
