import type {
  CreateDesignWorkLogInput,
  DesignWorkLogEntry,
  ListDesignWorkLogQuery,
  ListDesignWorkLogResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const designWorkLogKeys = {
  all: ['design-work-log'] as const,
  list: (q: ListDesignWorkLogQuery) =>
    [
      ...designWorkLogKeys.all,
      'list',
      q.engineer ?? null,
      q.fromDate ?? null,
      q.toDate ?? null,
      q.designProjectId ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildQs(q: ListDesignWorkLogQuery): string {
  const p = new URLSearchParams();
  if (q.engineer) p.set('engineer', q.engineer);
  if (q.fromDate) p.set('fromDate', q.fromDate);
  if (q.toDate) p.set('toDate', q.toDate);
  if (q.designProjectId) p.set('designProjectId', q.designProjectId);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useDesignWorkLogList(query: ListDesignWorkLogQuery) {
  return useQuery<ListDesignWorkLogResponse>({
    queryKey: designWorkLogKeys.list(query),
    queryFn: () =>
      apiFetch<ListDesignWorkLogResponse>(`/design-work-log?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreateDesignWorkLog() {
  const qc = useQueryClient();
  return useMutation<DesignWorkLogEntry, Error, CreateDesignWorkLogInput>({
    mutationFn: (input) =>
      apiFetch<DesignWorkLogEntry>('/design-work-log', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: designWorkLogKeys.all });
    },
  });
}

export function useDeleteDesignWorkLog() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/design-work-log/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: designWorkLogKeys.all });
    },
  });
}
