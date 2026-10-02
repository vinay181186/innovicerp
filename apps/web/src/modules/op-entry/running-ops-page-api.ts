// Live Operations board — the paged read (ADR-201). Kept beside api.ts so that
// file does not grow; the key sits under opEntryKeys' 'running' prefix.
import type { ListRunningOpsPageQuery, RunningOp } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { opEntryKeys } from './api';

/** Live Operations board — one page of `running` or `recent` sessions
 *  (ADR-201). Keyed under 'running' so every existing invalidation of the
 *  running list (start / stop / realtime) refreshes the board too. */
export function useRunningOpsPage(query: ListRunningOpsPageQuery) {
  return useQuery<{ items: RunningOp[]; total: number }>({
    queryKey: [...opEntryKeys.all, 'running', 'page', query] as const,
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('view', query.view);
      if (query.sf) p.set('sf', query.sf);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<{ items: RunningOp[]; total: number }>(
        `/op-entry/running-ops/page?${p.toString()}`,
      );
    },
    refetchInterval: 30_000, // 30s polling fallback alongside Realtime
    placeholderData: (prev) => prev,
  });
}
