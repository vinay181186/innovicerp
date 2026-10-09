import type {
  CreateMachineGroupInput,
  CreateMachineInput,
  DocumentEditStagedResult,
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
import { useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';

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
  if (q.sf) params.set('sf', q.sf);
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

/**
 * ADR-226 — re-read ONE machine straight from the server, ignoring the cache.
 *
 * `useEditConflict` calls this after a 409 so its retry lands on the version
 * that is actually stored. A cached read would defeat the whole thing: the
 * cache is what went stale in the first place. Mirrors
 * `useFetchNcRegister` in modules/nc-register/api.ts.
 */
export function useFetchMachine(): (id: string) => Promise<Machine> {
  const qc = useQueryClient();
  return useCallback(
    (id: string) =>
      qc.fetchQuery<Machine>({
        queryKey: machinesKeys.detail(id),
        queryFn: () => apiFetch<Machine>(`/machines/${id}`),
        staleTime: 0,
      }),
    [qc],
  );
}

export function useCreateMachine(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<Machine, Error, CreateMachineInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<Machine>('/machines', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      qc.setQueryData(machinesKeys.detail(created.id), created);
    },
  });
}

export function useUpdateMachine(id: string) {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the machine is live, the
  // PATCH returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated machine. The edit page reads the union to tell them
  // apart.
  return useMutation<Machine | DocumentEditStagedResult, Error, UpdateMachineInput>({
    mutationFn: (input) =>
      apiFetch<Machine | DocumentEditStagedResult>(`/machines/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: machinesKeys.lists() });
      if ('staged' in updated) {
        // Nothing changed on the machine itself — just refresh so the detail
        // page shows the new pending-change chips.
        void qc.invalidateQueries({ queryKey: machinesKeys.detail(id) });
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
        return;
      }
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

// The WHOLE master in one fetch, for the lookups (useMachineGroupLookup) — 1000
// is the cap listMachineGroupsQuerySchema allows. The Machine Groups tab itself
// pages by 25 (ADR-201) and never shares this query.
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
  if (q.sf) params.set('sf', q.sf);
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
    queryFn: () =>
      apiFetch<ListMachineGroupsResponse>(`/machine-groups?${groupsToQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCreateMachineGroup(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<MachineGroup, Error, CreateMachineGroupInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<MachineGroup>('/machine-groups', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: machineGroupsKeys.lists() });
    },
  });
}

export function useUpdateMachineGroup() {
  const qc = useQueryClient();
  // ADR-202 — the group has no detail page; when the edit-approval gate is on and
  // the group is live, the PATCH returns a DocumentEditStagedResult (staged for
  // approval) instead of the updated group. The tab reads the union to show the
  // neutral "Sent for approval" notice and the row's "edit pending" chip.
  return useMutation<
    MachineGroup | DocumentEditStagedResult,
    Error,
    { id: string; input: UpdateMachineGroupInput }
  >({
    mutationFn: ({ id, input }) =>
      apiFetch<MachineGroup | DocumentEditStagedResult>(`/machine-groups/${id}`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: machineGroupsKeys.lists() });
      void qc.invalidateQueries({ queryKey: machinesKeys.all });
      if ('staged' in updated) {
        // Nothing changed on the group — refresh the pending set so the row chip
        // shows.
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
      }
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
  // Its own params (no search / filter / sf, limit 1000) — never the tab's
  // 25-row page, so the lookup always holds every group.
  const list = useMachineGroupsList({ limit: MACHINE_GROUP_LIST_LIMIT, offset: 0 });
  const groups = list.data?.groups;
  return useMemo(() => new Map((groups ?? []).map((g) => [g.id, g])), [groups]);
}
