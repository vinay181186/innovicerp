import type {
  ListUserAccessQuery,
  ListUserAccessResponse,
  SaveUserAccessInput,
  UserAccess,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { myAccessKey } from '@/lib/access-control';

export const accessControlKeys = {
  all: ['access-control'] as const,
  list: () => [...accessControlKeys.all, 'list'] as const,
  page: (q: ListUserAccessQuery) => [...accessControlKeys.list(), q] as const,
  detail: (userId: string) => [...accessControlKeys.all, 'detail', userId] as const,
};

/** EVERY user with their access summary (User Management, Configure box). */
export function useUserAccessList(opts?: { enabled?: boolean }) {
  return useQuery<ListUserAccessResponse>({
    queryKey: accessControlKeys.list(),
    queryFn: () => apiFetch<ListUserAccessResponse>('/access-control/users'),
    enabled: opts?.enabled ?? true,
  });
}

/** One page of the Access Control screen (ADR-201): search + sf on the server. */
export function useUserAccessPage(q: ListUserAccessQuery) {
  return useQuery<ListUserAccessResponse>({
    queryKey: accessControlKeys.page(q),
    queryFn: () => {
      const params = new URLSearchParams();
      if (q.search) params.set('search', q.search);
      if (q.sf) params.set('sf', q.sf);
      if (q.limit !== undefined) params.set('limit', String(q.limit));
      if (q.offset !== undefined) params.set('offset', String(q.offset));
      return apiFetch<ListUserAccessResponse>(`/access-control/users?${params.toString()}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useUserAccess(userId: string | null) {
  return useQuery<UserAccess>({
    queryKey: accessControlKeys.detail(userId ?? '__none__'),
    queryFn: () =>
      apiFetch<UserAccess>(`/access-control/users/${encodeURIComponent(userId as string)}`),
    enabled: Boolean(userId),
  });
}

/** Re-read ONE user's access matrix from the server, bypassing the cache
 *  (ADR-225).
 *
 *  Used only after a save was refused 409 `edit_conflict`. Access Control
 *  deliberately does NOT merge: `departments` and `forms` are single JSONB
 *  blocks replaced wholesale, so merging two admins' partial matrices could
 *  produce a permission set neither of them approved. The box therefore reloads
 *  the stored matrix — writing `staleTime: 0` so it is the real one, not the
 *  cached photograph — and the admin re-applies their change. */
export function useFetchUserAccess(): (userId: string) => Promise<UserAccess> {
  const qc = useQueryClient();
  return useCallback(
    (userId: string) =>
      qc.fetchQuery<UserAccess>({
        queryKey: accessControlKeys.detail(userId),
        queryFn: () => apiFetch<UserAccess>(`/access-control/users/${encodeURIComponent(userId)}`),
        staleTime: 0,
      }),
    [qc],
  );
}

export function useSaveUserAccess() {
  const qc = useQueryClient();
  return useMutation<UserAccess, Error, { userId: string; input: SaveUserAccessInput }>({
    mutationFn: ({ userId, input }) =>
      apiFetch<UserAccess>(`/access-control/users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        json: input,
      }),
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: accessControlKeys.list() });
      qc.setQueryData(accessControlKeys.detail(saved.userId), saved);
      // If the admin just edited their OWN matrix, the sidebar gating
      // needs to refresh — invalidate /me/access too.
      void qc.invalidateQueries({ queryKey: myAccessKey });
    },
  });
}
