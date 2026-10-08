import type {
  CreateUserInput,
  ListUsersQuery,
  ListUsersResponse,
  SetUserPasswordInput,
  UpdateUserInput,
  User,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (q: ListUsersQuery) => [...usersKeys.lists(), q] as const,
  details: () => [...usersKeys.all, 'detail'] as const,
  detail: (id: string) => [...usersKeys.details(), id] as const,
};

function toQueryString(q: ListUsersQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.role) params.set('role', q.role);
  if (q.isActive !== undefined) params.set('isActive', String(q.isActive));
  if (q.sf) params.set('sf', q.sf);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useUsersList(
  query: ListUsersQuery,
  options?: Omit<UseQueryOptions<ListUsersResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListUsersResponse>({
    queryKey: usersKeys.list(query),
    queryFn: () => apiFetch<ListUsersResponse>(`/users?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useUser(id: string | undefined) {
  return useQuery<User>({
    queryKey: id ? usersKeys.detail(id) : usersKeys.detail('__missing__'),
    queryFn: () => apiFetch<User>(`/users/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * ADR-226 — re-read ONE user straight from the server, ignoring the cache.
 *
 * `useEditConflict` calls this after a 409 so its retry lands on the version
 * that is actually stored. A cached read would defeat the whole thing: the
 * cache is what went stale in the first place. Mirrors
 * `useFetchNcRegister` in modules/nc-register/api.ts.
 */
export function useFetchUser(): (id: string) => Promise<User> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<User>({
        queryKey: usersKeys.detail(id),
        queryFn: () => apiFetch<User>(`/users/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation<User, Error, CreateUserInput>({
    mutationFn: (input) => apiFetch<User>('/users', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation<User, Error, UpdateUserInput>({
    mutationFn: (input) => apiFetch<User>(`/users/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
      qc.setQueryData(usersKeys.detail(id), updated);
    },
  });
}

export function useSetUserPassword(id: string) {
  return useMutation<void, Error, SetUserPasswordInput>({
    mutationFn: async (input) => {
      await apiFetch<null>(`/users/${id}/set-password`, { method: 'POST', json: input });
    },
  });
}

export function useSoftDeleteUser() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/users/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
      qc.removeQueries({ queryKey: usersKeys.detail(id) });
    },
  });
}
