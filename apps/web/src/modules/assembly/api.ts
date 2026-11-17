import type {
  AssemblyListResponse,
  AssemblyTrackerResponse,
  AssemblyUnitRow,
  CreateAssemblyCustomerPartIssueInput,
  ListAssembliesQuery,
  MarkUnitAssembledInput,
  MarkUnitDispatchedInput,
  SetReadinessOverrideInput,
  StartAssemblyInput,
  StopAssemblyInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { partyMaterialIssuesKeys } from '@/modules/party-material-issues/api';
import { soStatusKeys } from '@/modules/so-status/api';

export const assemblyKeys = {
  all: ['assemblies'] as const,
  list: (q?: ListAssembliesQuery) =>
    q ? ([...assemblyKeys.all, 'list', q] as const) : ([...assemblyKeys.all, 'list'] as const),
  detail: (soId: string) => [...assemblyKeys.all, 'detail', soId] as const,
};

function listQueryString(q: ListAssembliesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (q.status) params.set('status', q.status);
  if (q.sf) params.set('sf', q.sf);
  if (q.limit !== undefined) params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

/** One page of the Assembly Tracker list (ADR-201) + its server-side counts. */
export function useAssembliesList(query: ListAssembliesQuery) {
  return useQuery<AssemblyListResponse>({
    queryKey: assemblyKeys.list(query),
    queryFn: () => apiFetch<AssemblyListResponse>(`/assemblies?${listQueryString(query)}`),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useAssemblyTracker(soId: string) {
  return useQuery<AssemblyTrackerResponse>({
    queryKey: assemblyKeys.detail(soId),
    queryFn: () => apiFetch<AssemblyTrackerResponse>(`/assemblies/${soId}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useMarkUnitAssembled(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MarkUnitAssembledInput) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/${soId}/units`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useStartAssembly(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAssemblyInput) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/${soId}/start`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useStopAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, input }: { unitId: string; input: StopAssemblyInput }) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/units/${unitId}/stop`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
      // ADR-193 3c — Complete / Undo change Fitted and Still Out.
      void qc.invalidateQueries({ queryKey: ['material'] });
    },
  });
}

export function useMarkUnitDispatched() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ unitId, input }: { unitId: string; input: MarkUnitDispatchedInput }) =>
      apiFetch<AssemblyUnitRow>(`/assemblies/units/${unitId}/dispatch`, {
        method: 'PATCH',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

export function useUndoLastUnit(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; removedUnitNo: number }>(`/assemblies/${soId}/units/last`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
      // ADR-193 3c — Complete / Undo change Fitted and Still Out.
      void qc.invalidateQueries({ queryKey: ['material'] });
    },
  });
}

export function useSetReadinessOverride(soId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ childCode, input }: { childCode: string; input: SetReadinessOverrideInput }) =>
      apiFetch<{ ok: true }>(`/assemblies/${soId}/overrides/${encodeURIComponent(childCode)}`, {
        method: 'PUT',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
    },
  });
}

/** ADR-307 — Assembly Tracker › "Issue Customer Part →": issue a customer-
 *  supplied BOM part from the customer store to this Equipment SO's assembly.
 *  The server caps the qty (in-store and need − issued) under its locks. */
export function useIssueCustomerPart(soId: string, saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAssemblyCustomerPartIssueInput) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<{ id: string; code: string }>(`/assemblies/${soId}/customer-part-issues`, {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assemblyKeys.all });
      void qc.invalidateQueries({ queryKey: soStatusKeys.all });
      void qc.invalidateQueries({ queryKey: partyMaterialIssuesKeys.all });
    },
  });
}
