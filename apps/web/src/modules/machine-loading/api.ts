import type { MachineLoadingQuery, MachineLoadingResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const machineLoadingKeys = {
  all: ['machine-loading'] as const,
};

function buildQs(q: MachineLoadingQuery): string {
  const p = new URLSearchParams();
  if (q.machineId) p.set('machineId', q.machineId);
  if (q.search) p.set('search', q.search);
  if (q.scope) p.set('scope', q.scope);
  if (q.sf) p.set('sf', q.sf);
  if (q.limit != null) p.set('limit', String(q.limit));
  if (q.offset != null) p.set('offset', String(q.offset));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/** One call of GET /machine-loading — with `limit`, one page of ops (ADR-201). */
export function fetchMachineLoading(q: MachineLoadingQuery = {}): Promise<MachineLoadingResponse> {
  return apiFetch<MachineLoadingResponse>(`/machine-loading${buildQs(q)}`);
}

/** No query = the whole board (production dashboard); with `limit` = one page. */
export function useMachineLoading(query?: MachineLoadingQuery) {
  return useQuery<MachineLoadingResponse>({
    queryKey: query ? [...machineLoadingKeys.all, query] : machineLoadingKeys.all,
    queryFn: () => fetchMachineLoading(query),
    // Live-ish: ops availability shifts as the floor logs work.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}
