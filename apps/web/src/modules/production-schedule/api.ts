import type {
  ProductionScheduleQuery,
  ProductionScheduleResponse,
  RescheduleJcOpInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const productionScheduleKeys = {
  all: ['production-schedule'] as const,
  view: (q: ProductionScheduleQuery) =>
    [...productionScheduleKeys.all, q.startDate ?? null, q.filter] as const,
};

function buildQs(q: ProductionScheduleQuery): string {
  const p = new URLSearchParams();
  if (q.startDate) p.set('startDate', q.startDate);
  if (q.filter) p.set('filter', q.filter);
  return p.toString();
}

export function useProductionSchedule(query: ProductionScheduleQuery) {
  return useQuery<ProductionScheduleResponse>({
    queryKey: productionScheduleKeys.view(query),
    queryFn: () =>
      apiFetch<ProductionScheduleResponse>(`/production-schedule?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useRescheduleJcOp() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { jcOpId: string; input: RescheduleJcOpInput }>({
    mutationFn: ({ jcOpId, input }) =>
      apiFetch<{ ok: true }>(`/production-schedule/ops/${jcOpId}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: productionScheduleKeys.all });
    },
  });
}
