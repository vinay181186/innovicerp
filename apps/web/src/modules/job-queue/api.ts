import type {
  JobQueueQuery,
  JobQueueResponse,
  ReorderJobQueueInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jobQueueKeys = {
  all: ['job-queue'] as const,
  view: (q: JobQueueQuery) => [...jobQueueKeys.all, q.machineId ?? null] as const,
};

function buildQs(q: JobQueueQuery): string {
  const p = new URLSearchParams();
  if (q.machineId) p.set('machineId', q.machineId);
  return p.toString();
}

export function useJobQueue(query: JobQueueQuery) {
  return useQuery<JobQueueResponse>({
    queryKey: jobQueueKeys.view(query),
    queryFn: () => {
      const qs = buildQs(query);
      return apiFetch<JobQueueResponse>(`/job-queue${qs ? `?${qs}` : ''}`);
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useReorderJobQueue() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true },
    Error,
    { machineId: string; input: ReorderJobQueueInput },
    { snaps: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: ({ machineId, input }) =>
      apiFetch<{ ok: true }>(`/job-queue/machines/${machineId}/order`, {
        method: 'PUT',
        json: input,
      }),
    // Optimistic update: rewrite the cached machine's `rows` in the new
    // order so the UI flips before the network roundtrip.
    onMutate: async ({ machineId, input }) => {
      await qc.cancelQueries({ queryKey: jobQueueKeys.all });
      const snaps: Array<[readonly unknown[], unknown]> = [];
      const cached = qc.getQueriesData<JobQueueResponse>({ queryKey: jobQueueKeys.all });
      for (const [key, value] of cached) {
        snaps.push([key, value]);
        if (!value) continue;
        const next: JobQueueResponse = {
          ...value,
          machines: value.machines.map((m) => {
            if (m.machineId !== machineId) return m;
            const byId = new Map(m.rows.map((r) => [r.jcOpId, r]));
            const ordered = input.jcOpIds
              .map((id) => byId.get(id))
              .filter((x): x is (typeof m.rows)[number] => Boolean(x));
            const inSet = new Set(input.jcOpIds);
            for (const r of m.rows) if (!inSet.has(r.jcOpId)) ordered.push(r);
            return { ...m, rows: ordered };
          }),
        };
        qc.setQueryData(key, next);
      }
      return { snaps };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snaps) {
        for (const [key, value] of ctx.snaps) qc.setQueryData(key, value);
      }
    },
    onSettled: () => {
      // Server-side ORDER BY queue_position re-confirms the new order.
      void qc.refetchQueries({ queryKey: jobQueueKeys.all });
    },
  });
}
