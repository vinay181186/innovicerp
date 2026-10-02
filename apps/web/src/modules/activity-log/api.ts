// Activity log TanStack Query hooks (T-051, ADR-197).

import type {
  ActivityHistoryResponse,
  ListActivityLogQuery,
  ListActivityLogResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const activityLogKeys = {
  all: ['activity-log'] as const,
  list: (q: ListActivityLogQuery) => [...activityLogKeys.all, 'list', q] as const,
  history: (entity: string, entityId: string | null, refId: string | null) =>
    [...activityLogKeys.all, 'history', entity, entityId, refId] as const,
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
      if (query.sf) params.set('sf', query.sf);
      params.set('limit', String(query.limit));
      params.set('offset', String(query.offset));
      return apiFetch<ListActivityLogResponse>(`/activity-log?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

/** Which document's history to load. Give the id AND the code when the page
 *  has both — rows written before ADR-197 carry only the code. */
export interface DocumentHistoryTarget {
  /** Standard entity name (`ACTIVITY_ENTITIES`), e.g. 'PurchaseOrder'. */
  entity: string;
  entityId?: string | null | undefined;
  /** The document code, e.g. IN-PO-00012. */
  refId?: string | null | undefined;
}

/**
 * One document's History rows, newest first (GET /activity-log/history).
 *
 * One query, two callers: the page reads `data.rows.length` for the History
 * tab's count, the <DocumentHistory> body reads the rows — both share the one
 * cache entry. After a mutation on the document, invalidate
 * `activityLogKeys.all` (or the `history` key) so the tab refreshes.
 */
export function useDocumentHistory({ entity, entityId, refId }: DocumentHistoryTarget) {
  const id = entityId ?? null;
  const code = refId ?? null;
  return useQuery<ActivityHistoryResponse>({
    queryKey: activityLogKeys.history(entity, id, code),
    queryFn: () => {
      const params = new URLSearchParams({ entity });
      if (id) params.set('entityId', id);
      if (code) params.set('refId', code);
      return apiFetch<ActivityHistoryResponse>(`/activity-log/history?${params.toString()}`);
    },
    enabled: Boolean(entity) && Boolean(id ?? code),
  });
}
