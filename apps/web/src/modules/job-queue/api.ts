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
    { machineId: string; input: ReorderJobQueueInput }
  >({
    mutationFn: ({ machineId, input }) =>
      apiFetch<{ ok: true }>(`/job-queue/machines/${machineId}/order`, {
        method: 'PUT',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobQueueKeys.all });
    },
  });
}
