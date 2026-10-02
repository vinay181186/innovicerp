import type {
  JobQueueQuery,
  JobQueueResponse,
  MoveJobQueueOpInput,
  ReorderJobQueueInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jobQueueKeys = {
  all: ['job-queue'] as const,
  view: (q: JobQueueQuery) =>
    [
      ...jobQueueKeys.all,
      q.machineId ?? null,
      q.search ?? null,
      q.limit ?? null,
      q.offset ?? null,
    ] as const,
};

function buildQs(q: JobQueueQuery): string {
  const p = new URLSearchParams();
  if (q.machineId) p.set('machineId', q.machineId);
  if (q.search) p.set('search', q.search);
  if (q.limit != null) p.set('limit', String(q.limit));
  if (q.offset != null) p.set('offset', String(q.offset));
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

/** Admin one-time hygiene: link ops that carry a machine as text only to the
 *  matching machine FK. Idempotent. Refetches the queue on success. */
export function useBackfillMachineIds() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: () =>
      apiFetch<{ updated: number }>('/job-queue/backfill-machine-ids', { method: 'POST' }),
    onSuccess: () => {
      void qc.refetchQueries({ queryKey: jobQueueKeys.all });
    },
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

/**
 * ▲/▼ on one row (ADR-201). The server swaps the op with its neighbour in the
 * machine's FULL queue — the screen holds one 25-row page, so it can no longer
 * send the whole order. Optimistic: when both rows are on the cached page they
 * swap at once; a move across a page edge simply shows after the refetch.
 */
export function useMoveJobQueueOp() {
  const qc = useQueryClient();
  return useMutation<
    { ok: true },
    Error,
    { machineId: string; input: MoveJobQueueOpInput },
    { snaps: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: ({ machineId, input }) =>
      apiFetch<{ ok: true }>(`/job-queue/machines/${machineId}/move`, {
        method: 'POST',
        json: input,
      }),
    onMutate: async ({ machineId, input }) => {
      await qc.cancelQueries({ queryKey: jobQueueKeys.all });
      const snaps: Array<[readonly unknown[], unknown]> = [];
      for (const [key, value] of qc.getQueriesData<JobQueueResponse>({
        queryKey: jobQueueKeys.all,
      })) {
        snaps.push([key, value]);
        if (!value) continue;
        qc.setQueryData<JobQueueResponse>(key, {
          ...value,
          machines: value.machines.map((m) => {
            if (m.machineId !== machineId) return m;
            const idx = m.rows.findIndex((r) => r.jcOpId === input.jcOpId);
            const swap = input.dir === 'up' ? idx - 1 : idx + 1;
            const a = m.rows[idx];
            const b = m.rows[swap];
            // Only neighbours in the FULL queue (consecutive queueIndex) swap here.
            if (!a || !b || a.queueIndex == null || b.queueIndex == null) return m;
            if (Math.abs(a.queueIndex - b.queueIndex) !== 1) return m;
            const rows = [...m.rows];
            rows[idx] = { ...b, queueIndex: a.queueIndex };
            rows[swap] = { ...a, queueIndex: b.queueIndex };
            return { ...m, rows };
          }),
        });
      }
      return { snaps };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, value] of ctx?.snaps ?? []) qc.setQueryData(key, value);
    },
    onSettled: () => {
      void qc.refetchQueries({ queryKey: jobQueueKeys.all });
    },
  });
}
