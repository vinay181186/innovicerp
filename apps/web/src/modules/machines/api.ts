import type {
  CreateMachineGroupInput,
  CreateMachineInput,
  ListMachineGroupsQuery,
  ListMachineGroupsResponse,
  ListMachinesQuery,
  ListMachinesResponse,
  Machine,
  MachineGroup,
  UpdateMachineGroupInput,
  UpdateMachineInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiFetch } from '@/lib/api';

export const machinesKeys = {
  all: ['machines'] as const,
  lists: () => [...machinesKeys.all, 'list'] as const,
  list: (q: ListMachinesQuery) => [...machinesKeys.lists(), q] as const,
  details: () => [...machinesKeys.all, 'detail'] as const,
  detail: (id: string) => [...machinesKeys.details(), id] as const,
};

function toQueryString(q: ListMachinesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useMachinesList(
  query: ListMachinesQuery,
  options?: Omit<UseQueryOptions<ListMachinesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMachinesResponse>({
    queryKey: machinesKeys.list(query),
    queryFn: () => apiFetch<ListMachinesResponse>(`/machines?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useMachine(id: string | undefined) {
  return useQuery<Machine>({
    queryKey: id ? machinesKeys.detail(id) : machinesKeys.detail('__missing__'),
    queryFn: () => apiFetch<Machine>(`/machines/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation<Machine, Error, CreateMachineInput>({
    mutationFn: (input) => apiFetch<Machine>('/machines', { method: 'POST', json: input }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.setQueryData(machinesKeys.detail(created.id), created);
    },
  });
}

export function useUpdateMachine(id: string) {
  const qc = useQueryClient();
  return useMutation<Machine, Error, UpdateMachineInput>({
    mutationFn: (input) => apiFetch<Machine>(`/machines/${id}`, { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.setQueryData(machinesKeys.detail(id), updated);
    },
  });
}

export function useSoftDeleteMachine() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/machines/${id}`, { method: 'DELETE' });
    },
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.removeQueries({ queryKey: machinesKeys.detail(id) });
    },
  });
}

/* ───────────────────── MACHINE GROUP MASTER ─────────────────────
 * The second tab of the Machine Master screen (VMC, CNC, Lathe…). Same shape
 * as modules/raw-material/api.ts's material-grade hooks: one key space, one
 * list endpoint that returns the WHOLE master in a single fetch, and three
 * writes that just invalidate the list. Kept in the machines module because
 * the group only ever exists to be picked on the machine form.
 *
 * A write here also invalidates the MACHINE lists and details: the machines
 * service keeps a denormalised copy of the group code on each machine, so a
 * group going inactive changes what those screens should offer.
 */

// Masters scroll, they do not paginate: one fetch, the whole master. 1000 is
// the cap listMachineGroupsQuerySchema allows.
export const MACHINE_GROUP_LIST_LIMIT = 1000;

export const machineGroupsKeys = {
  all: ['machine-groups'] as const,
  lists: () => [...machineGroupsKeys.all, 'list'] as const,
  list: (q: ListMachineGroupsQuery) => [...machineGroupsKeys.lists(), q] as const,
};

function groupsToQueryString(q: ListMachineGroupsQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useMachineGroupsList(
  query: ListMachineGroupsQuery,
  options?: Omit<UseQueryOptions<ListMachineGroupsResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMachineGroupsResponse>({
    queryKey: machineGroupsKeys.list(query),
    queryFn: () => apiFetch<ListMachineGroupsResponse>(`/machine-groups?${groupsToQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCreateMachineGroup() {
  const qc = useQueryClient();
  return useMutation<MachineGroup, Error, CreateMachineGroupInput>({
    mutationFn: (input) => apiFetch<MachineGroup>('/machine-groups', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: machineGroupsKeys.lists() });
    },
  });
}

export function useUpdateMachineGroup() {
  const qc = useQueryClient();
  return useMutation<MachineGroup, Error, { id: string; input: UpdateMachineGroupInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<MachineGroup>(`/machine-groups/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: machineGroupsKeys.lists() });
      void qc.invalidateQueries({ queryKey: machinesKeys.all });
    },
  });
}

export function useSoftDeleteMachineGroup() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/machine-groups/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: machineGroupsKeys.lists() });
      void qc.invalidateQueries({ queryKey: machinesKeys.all });
    },
  });
}

/** id → group, for the screens that only hold a machine's `machineGroupId` and
 *  need the word the user typed ('VMC'). ONE fetch of the whole master, shared
 *  by the list, the detail page and the form because the query key is identical.
 *  Inactive groups are included on purpose: a machine linked to a retired group
 *  must still read as that group, not as a blank. */
export function useMachineGroupLookup(): Map<string, MachineGroup> {
  const list = useMachineGroupsList({ limit: MACHINE_GROUP_LIST_LIMIT, offset: 0 });
  const groups = list.data?.groups;
  return useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
}
