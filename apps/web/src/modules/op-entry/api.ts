// Op Entry data layer (T-025b). TanStack Query hooks + Realtime subscriptions
// per ADR-004 (Realtime is on for op_log + running_ops, the two hot tables).
//
// Optimistic update on useSubmitOpLog mutates the cached jc_ops row before the
// server round-trip — operator UI feels instant. The Realtime sub on op_log
// invalidates the list a second time when the server's INSERT propagates,
// reconciling any drift.

import type {
  DecideOpLogTimeChangeInput,
  GenerateOspPrInput,
  GenerateOspPrResult,
  JcOpEnriched,
  ListJcOpsQuery,
  ListOpLogQuery,
  ListOpLogTimeChangeRequestsQuery,
  ListOpMachineOutputQuery,
  ListRunningOpsQuery,
  OpLog,
  OpLogTimeChangeRequest,
  OpMachineOutput,
  RunningOp,
  StartOpInput,
  SubmitOpLogInput,
  SubmitQcLogInput,
  UpdateOpLogTimingInput,
  UpdateOpLogTimingResult,
} from '@innovic/shared';
import {
  type QueryClient,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { jcOpsBoardKeys } from '@/modules/jc-ops/api';
import { jobQueueKeys } from '@/modules/job-queue/api';

export const opEntryKeys = {
  all: ['op-entry'] as const,
  jcOps: (q: ListJcOpsQuery) => [...opEntryKeys.all, 'jc-ops', q] as const,
  opLog: (q: ListOpLogQuery) => [...opEntryKeys.all, 'op-log', q] as const,
  machineOutput: (q: ListOpMachineOutputQuery) =>
    [...opEntryKeys.all, 'machine-output', q] as const,
  timeChanges: (q: ListOpLogTimeChangeRequestsQuery) =>
    [...opEntryKeys.all, 'time-changes', q] as const,
  running: (q: ListRunningOpsQuery) => [...opEntryKeys.all, 'running', q] as const,
};

// ─── Reads ────────────────────────────────────────────────────────────────

export function useJcOpsEnriched(
  query: ListJcOpsQuery,
  options?: Omit<UseQueryOptions<JcOpEnriched[]>, 'queryKey' | 'queryFn'>,
) {
  const params = new URLSearchParams();
  if (query.jobCardId) params.set('jobCardId', query.jobCardId);
  if (query.jobCardCode) params.set('jobCardCode', query.jobCardCode);
  if (query.machineId) params.set('machineId', query.machineId);
  return useQuery<JcOpEnriched[]>({
    queryKey: opEntryKeys.jcOps(query),
    queryFn: () => apiFetch<JcOpEnriched[]>(`/op-entry/jc-ops?${params.toString()}`),
    enabled: Boolean(query.jobCardId || query.jobCardCode || query.machineId),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useOpLog(
  query: ListOpLogQuery,
  options?: Omit<UseQueryOptions<OpLog[]>, 'queryKey' | 'queryFn'>,
) {
  const params = new URLSearchParams();
  if (query.jcOpId) params.set('jcOpId', query.jcOpId);
  if (query.jobCardId) params.set('jobCardId', query.jobCardId);
  params.set('limit', String(query.limit ?? 100));
  return useQuery<OpLog[]>({
    queryKey: opEntryKeys.opLog(query),
    queryFn: () => apiFetch<OpLog[]>(`/op-entry/op-log?${params.toString()}`),
    enabled: Boolean(query.jcOpId || query.jobCardId),
    ...options,
  });
}

// Machine-wise output (0095). One row per (op × machine) so a mid-run machine
// change shows as two permanent rows instead of re-attributing past production.
export function useOpMachineOutput(
  query: ListOpMachineOutputQuery,
  options?: Omit<UseQueryOptions<OpMachineOutput[]>, 'queryKey' | 'queryFn'>,
) {
  const params = new URLSearchParams();
  if (query.jcOpId) params.set('jcOpId', query.jcOpId);
  if (query.jobCardId) params.set('jobCardId', query.jobCardId);
  return useQuery<OpMachineOutput[]>({
    queryKey: opEntryKeys.machineOutput(query),
    queryFn: () => apiFetch<OpMachineOutput[]>(`/op-entry/machine-output?${params.toString()}`),
    enabled: Boolean(query.jcOpId || query.jobCardId),
    ...options,
  });
}

export function useRunningOps(
  query: ListRunningOpsQuery = {},
  options?: Omit<UseQueryOptions<RunningOp[]>, 'queryKey' | 'queryFn'>,
) {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  return useQuery<RunningOp[]>({
    queryKey: opEntryKeys.running(query),
    queryFn: () => apiFetch<RunningOp[]>(`/op-entry/running-ops?${params.toString()}`),
    refetchInterval: 30_000, // 30s polling fallback alongside Realtime
    ...options,
  });
}

// ─── Writes (with optimistic update on submit) ────────────────────────────

interface OptimisticContext {
  prevJcOpsByKey: Array<readonly [readonly unknown[], JcOpEnriched[] | undefined]>;
}

/** Invalidate the production read-models that live OUTSIDE the op-entry module
 *  but render the same op_log / jc_ops / status data — the Job Card Detail
 *  (header stat cards, status extras, outsource cells) and the Job Queue board.
 *  Called after every op-entry write so those screens refresh immediately
 *  instead of waiting on the global staleTime / the queue's 60s interval. */
function invalidateProductionViews(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: jobCardsKeys.all });
  void qc.invalidateQueries({ queryKey: jobQueueKeys.all });
  void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
}

export function useSubmitOpLog() {
  const qc = useQueryClient();
  return useMutation<OpLog, Error, SubmitOpLogInput, OptimisticContext>({
    mutationFn: (input) => apiFetch<OpLog>('/op-entry/op-log', { method: 'POST', json: input }),
    onMutate: async (input) => {
      // Cancel any in-flight jc-ops queries so they don't overwrite the optimistic write.
      await qc.cancelQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      // Snapshot every cached jc-ops list so we can roll back on error.
      const prev = qc.getQueriesData<JcOpEnriched[]>({
        queryKey: [...opEntryKeys.all, 'jc-ops'],
      });
      // Optimistically decrement available, bump completedQty.
      for (const [key, rows] of prev) {
        if (!rows) continue;
        qc.setQueryData<JcOpEnriched[]>(
          key,
          rows.map((row) =>
            row.id === input.jcOpId
              ? {
                  ...row,
                  completedQty: row.completedQty + input.qty,
                  available: Math.max(0, row.available - input.qty),
                  computedStatus:
                    row.available - input.qty <= 0
                      ? row.qcRequired
                        ? 'qc_pending'
                        : 'complete'
                      : row.completedQty + input.qty > 0
                        ? 'in_progress'
                        : row.computedStatus,
                }
              : row,
          ),
        );
      }
      return { prevJcOpsByKey: prev };
    },
    onError: (_err, _input, ctx) => {
      // Roll back the optimistic write.
      if (!ctx) return;
      for (const [key, snapshot] of ctx.prevJcOpsByKey) {
        qc.setQueryData(key, snapshot);
      }
    },
    onSettled: () => {
      // Always reconcile against the server.
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      // Prefix, not the narrow {jcOpId,limit:100} key, so the JC Detail's
      // {jobCardId,limit:300} "Recent Logs" query also refetches.
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'op-log'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'machine-output'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
      invalidateProductionViews(qc);
    },
  });
}

// QC inspection submit (T-040d). Same shape as useSubmitOpLog but writes the
// QC log path. No optimistic update on this mutation — qc_pending math from
// the view is non-trivial to mirror client-side, and a 200ms server round-trip
// for QC inspections is acceptable. The Realtime sub on op_log invalidates
// after the server INSERT propagates anyway.
export function useSubmitQcLog() {
  const qc = useQueryClient();
  return useMutation<OpLog, Error, SubmitQcLogInput>({
    mutationFn: (input) => apiFetch<OpLog>('/op-entry/qc-log', { method: 'POST', json: input }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'op-log'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'machine-output'] });
      invalidateProductionViews(qc);
    },
  });
}

// Correct an entry's date/time (ADR-127). Invalidates the same views as a
// submit because the JC completion feed and the Daily Report are both ordered
// and filtered by log_date — a retimed entry moves in them. Machine-output is
// NOT invalidated: qty cannot change here, only when it happened.
//
// Under ADR-130 the result may come back `applied: false` — the entry is
// untouched and the change is queued for a manager. The extra invalidations
// are harmless in that case and necessary in the other.
export function useUpdateOpLogTiming() {
  const qc = useQueryClient();
  return useMutation<UpdateOpLogTimingResult, Error, UpdateOpLogTimingInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<UpdateOpLogTimingResult>(`/op-entry/op-log/${id}/timing`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'op-log'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'time-changes'] });
      invalidateProductionViews(qc);
    },
  });
}

// ─── Timing-change approvals (ADR-130) ─────────────────────────────────────

export function useOpLogTimeChangeRequests(
  query: ListOpLogTimeChangeRequestsQuery,
  options?: { enabled?: boolean },
) {
  return useQuery<OpLogTimeChangeRequest[]>({
    queryKey: opEntryKeys.timeChanges(query),
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.status) p.set('status', query.status);
      if (query.jcOpId) p.set('jcOpId', query.jcOpId);
      p.set('limit', String(query.limit));
      return apiFetch<OpLogTimeChangeRequest[]>(`/op-entry/time-changes?${p.toString()}`);
    },
    ...(options?.enabled === undefined ? {} : { enabled: options.enabled }),
  });
}

/** Count for the sidebar badge. Cheap enough to poll: the inbox is normally
 *  empty and the row cap is 200. */
export function usePendingTimeChangeCount(enabled: boolean): number {
  const q = useOpLogTimeChangeRequests({ status: 'pending', limit: 200 }, { enabled });
  return q.data?.length ?? 0;
}

export function useDecideOpLogTimeChange() {
  const qc = useQueryClient();
  return useMutation<OpLogTimeChangeRequest, Error, DecideOpLogTimeChangeInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<OpLogTimeChangeRequest>(`/op-entry/time-changes/${id}/decide`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'time-changes'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'op-log'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
      invalidateProductionViews(qc);
    },
  });
}

export function useStartOp() {
  const qc = useQueryClient();
  return useMutation<RunningOp, Error, StartOpInput>({
    mutationFn: (input) => apiFetch<RunningOp>('/op-entry/start', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
      invalidateProductionViews(qc);
    },
  });
}

// OSP auto-PR generation (ADR-039). Invalidates jc-ops so the op's outsource
// status flips to pr_raised / po_created in the table immediately.
export function useGenerateOspPr() {
  const qc = useQueryClient();
  return useMutation<GenerateOspPrResult, Error, GenerateOspPrInput>({
    mutationFn: (input) =>
      apiFetch<GenerateOspPrResult>('/op-entry/osp-pr', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      invalidateProductionViews(qc);
    },
  });
}

export function useStopOp() {
  const qc = useQueryClient();
  return useMutation<RunningOp, Error, string>({
    mutationFn: (id) => apiFetch<RunningOp>(`/op-entry/running-ops/${id}/stop`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
      invalidateProductionViews(qc);
    },
  });
}

// ─── Realtime subscriptions ───────────────────────────────────────────────

// Subscribe to op_log INSERTs filtered by jc_op_id; invalidate the relevant
// queries when the server's INSERT propagates (reconciles optimistic writes).
export function useRealtimeOpLog(jcOpId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!jcOpId) return;
    const channel = supabase
      .channel(`op-log:${jcOpId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'op_log', filter: `jc_op_id=eq.${jcOpId}` },
        () => {
          void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
          void qc.invalidateQueries({ queryKey: opEntryKeys.opLog({ jcOpId, limit: 100 }) });
          // Prefix, so both the per-op and the whole-JC machine breakdowns refresh.
          void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'machine-output'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jcOpId, qc]);
}

// Subscribe to running_ops changes for the company. The subscription itself
// inherits the company filter via RLS at the WebSocket layer (Supabase
// Realtime applies RLS to the row stream).
export function useRealtimeRunningOps(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('running-ops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'running_ops' }, () => {
        void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'running'] });
        void qc.invalidateQueries({ queryKey: [...opEntryKeys.all, 'jc-ops'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
