// Day Log data hooks (owner 2026-10-26). One hook per endpoint of
// /day-logs; every write answers the whole day (DayLogDetail), so a write
// puts that answer straight into the day's cache and invalidates the rest of
// `dayLogKeys.all` (team table, other days). The screen shows the server's
// `summary` — it never works out the rules itself (CLAUDE.md §6 rule 1).

import type {
  AddDayLogEntryInput,
  DayLogAccess,
  DayLogDateInput,
  DayLogDetail,
  DayLogReasonInput,
  DayLogTaskOption,
  DayLogUserDayInput,
  Holiday,
  HolidayInput,
  MyBreaksResponse,
  SaveMyBreaksInput,
  SetDayLogEntryStatusInput,
  StartDayLogTimerInput,
  StopDayLogTimerInput,
  TeamDayLogResponse,
} from '@innovic/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';

export interface DayQuery {
  date?: string | undefined;
  userId?: string | undefined;
}

export const dayLogKeys = {
  all: ['day-logs'] as const,
  access: () => [...dayLogKeys.all, 'access'] as const,
  day: (q: DayQuery) => [...dayLogKeys.all, 'day', q.date ?? '', q.userId ?? ''] as const,
  team: (date: string) => [...dayLogKeys.all, 'team', date] as const,
  myBreaks: () => [...dayLogKeys.all, 'my-breaks'] as const,
  holidays: () => [...dayLogKeys.all, 'holidays'] as const,
  taskOptions: (search: string) => [...dayLogKeys.all, 'task-options', search] as const,
};

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Reads ──

export function useDayLogAccess() {
  return useQuery<DayLogAccess>({
    queryKey: dayLogKeys.access(),
    queryFn: () => apiFetch<DayLogAccess>('/day-logs/access'),
    staleTime: 5 * 60_000,
  });
}

export function useDayLog(q: DayQuery) {
  return useQuery<DayLogDetail>({
    queryKey: dayLogKeys.day(q),
    queryFn: () => apiFetch<DayLogDetail>(`/day-logs/day${qs({ date: q.date, userId: q.userId })}`),
    // The timer may have been stopped on another PC — read again on focus.
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

export function useTeamDayLogs(date: string | undefined, enabled = true) {
  return useQuery<TeamDayLogResponse>({
    queryKey: dayLogKeys.team(date ?? ''),
    queryFn: () => apiFetch<TeamDayLogResponse>(`/day-logs/team${qs({ date })}`),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMyBreaks(enabled = true) {
  return useQuery<MyBreaksResponse>({
    queryKey: dayLogKeys.myBreaks(),
    queryFn: () => apiFetch<MyBreaksResponse>('/day-logs/my-breaks'),
    enabled,
  });
}

export function useHolidays(enabled = true) {
  return useQuery<{ holidays: Holiday[] }>({
    queryKey: dayLogKeys.holidays(),
    queryFn: () => apiFetch<{ holidays: Holiday[] }>('/day-logs/holidays'),
    enabled,
  });
}

export function useDayLogTaskOptions(search: string, enabled = true) {
  return useQuery<DayLogTaskOption[]>({
    queryKey: dayLogKeys.taskOptions(search),
    queryFn: () => apiFetch<DayLogTaskOption[]>(`/day-logs/task-options${qs({ search })}`),
    staleTime: 30_000,
    enabled,
  });
}

// ── Writes ──

/** A write that answers the day: the answer replaces that day in the cache
 *  (the screen redraws without a second round trip), then everything else
 *  under dayLogKeys.all is marked stale. */
function useDayWrite<TInput>(run: (input: TInput) => Promise<DayLogDetail>, q: DayQuery) {
  const qc = useQueryClient();
  return useMutation<DayLogDetail, Error, TInput>({
    mutationFn: run,
    onSuccess: (day) => {
      // Stopping a timer left on an earlier day answers THAT day — only
      // replace the cache when the answer is the day this screen shows.
      if (day.date === (q.date ?? day.today)) qc.setQueryData(dayLogKeys.day(q), day);
      void qc.invalidateQueries({ queryKey: dayLogKeys.all });
    },
  });
}

/** `saveKey`: one Idempotency-Key reused for every retry of the same add, so
 *  a double click or a resend after a timeout makes ONE entry (ADR-172 R2). */
export function useAddDayLogEntry(q: DayQuery, saveKey?: SaveKey) {
  return useDayWrite<AddDayLogEntryInput>(
    (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogDetail>('/day-logs/entries', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    q,
  );
}

export function useStartDayLogTimer(q: DayQuery, saveKey?: SaveKey) {
  return useDayWrite<StartDayLogTimerInput>(
    (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogDetail>('/day-logs/timer/start', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    q,
  );
}

export function useStopDayLogTimer(q: DayQuery) {
  return useDayWrite<StopDayLogTimerInput>(
    (input) => apiFetch<DayLogDetail>('/day-logs/timer/stop', { method: 'POST', json: input }),
    q,
  );
}

export function useSetDayLogEntryStatus(q: DayQuery) {
  return useDayWrite<{ id: string } & SetDayLogEntryStatusInput>(
    ({ id, ...input }) =>
      apiFetch<DayLogDetail>(`/day-logs/entries/${id}/status`, { method: 'PATCH', json: input }),
    q,
  );
}

export function useRemoveDayLogEntry(q: DayQuery) {
  return useDayWrite<string>(
    (id) => apiFetch<DayLogDetail>(`/day-logs/entries/${id}`, { method: 'DELETE' }),
    q,
  );
}

export function useSubmitDayLog(q: DayQuery) {
  return useDayWrite<DayLogDateInput>(
    (input) => apiFetch<DayLogDetail>('/day-logs/submit', { method: 'POST', json: input }),
    q,
  );
}

/** Department Admin: Reopen a submitted / leave day, or mark a day Leave. */
export function useDayLogAdminAction(kind: 'reopen' | 'leave', q: DayQuery) {
  return useDayWrite<DayLogReasonInput>(
    (input) => apiFetch<DayLogDetail>(`/day-logs/${kind}`, { method: 'POST', json: input }),
    q,
  );
}

export function useRemindDayLog() {
  return useMutation<{ ok: true }, Error, DayLogUserDayInput>({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>('/day-logs/remind', { method: 'POST', json: input }),
  });
}

export function useSaveMyBreaks() {
  const qc = useQueryClient();
  return useMutation<MyBreaksResponse, Error, SaveMyBreaksInput>({
    mutationFn: (input) =>
      apiFetch<MyBreaksResponse>('/day-logs/my-breaks', { method: 'PUT', json: input }),
    onSuccess: (res) => {
      qc.setQueryData(dayLogKeys.myBreaks(), res);
      // Breaks change Work needed / Missing on every open day.
      void qc.invalidateQueries({ queryKey: dayLogKeys.all });
    },
  });
}

export function useAddHoliday() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, HolidayInput>({
    mutationFn: (input) => apiFetch('/day-logs/holidays', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dayLogKeys.all }),
  });
}

export function useRemoveHoliday() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => apiFetch(`/day-logs/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: dayLogKeys.all }),
  });
}
