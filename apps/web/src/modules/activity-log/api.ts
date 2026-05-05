// Activity log TanStack Query hooks (T-051).

import type { ListActivityLogQuery, ListActivityLogResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const activityLogKeys = {
  all: ['activity-log'] as const,
  list: (q: ListActivityLogQuery) => [...activityLogKeys.all, 'list', q] as const,
};

export function useActivityLog(query: ListActivityLogQuery) {
  return useQuery<ListActivityLogResponse>({
    queryKey: activityLogKeys.list(query),
    queryFn: () => {
      const params = new URLSearchParams();
      if (query.search) params.set('search', query.search);
      if (query.action) params.set('action', query.action);
      if (query.userId) params.set('userId', query.userId);
      if (query.fromDate) params.set('fromDate', query.fromDate);
      if (query.toDate) params.set('toDate', query.toDate);
      params.set('limit', String(query.limit));
      params.set('offset', String(query.offset));
      return apiFetch<ListActivityLogResponse>(`/activity-log?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}
