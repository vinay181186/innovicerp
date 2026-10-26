// Day Log data hooks (owner 2026-10-26, design approved 2026-10-26). One
// hook per endpoint of /day-logs; every write answers the whole day
// (DayLogDetail), so a write puts that answer straight into the day's cache
// and invalidates the rest of `dayLogKeys.all` (team table, person page).
// The screen shows the server's `summary` — it never works out the rules
// itself (CLAUDE.md §6 rule 1).

import type {
  AddDayLogEntryInput,
  DayLogAccess,
  DayLogDateInput,
  DayLogDetail,
  DayLogOrderOption,
  Holiday,
  HolidayInput,
  PersonDayLogResponse,
  TeamDayLogResponse,
  UpdateDayLogEntryInput,
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
  person: (userId: string, from: string, to: string) =>
    [...dayLogKeys.all, 'person', userId, from, to] as const,
  orders: (search: string) => [...dayLogKeys.all, 'order-options', search] as const,
  holidays: () => [...dayLogKeys.all, 'holidays'] as const,
};

/** Live screens read again every minute (an Open entry's time moves on). */
const LIVE_MS = 60_000;

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

export function useDayLog(q: DayQuery, enabled = true) {
  return useQuery<DayLogDetail>({
    queryKey: dayLogKeys.day(q),
    queryFn: () => apiFetch<DayLogDetail>(`/day-logs/day${qs({ date: q.date, userId: q.userId })}`),
    refetchOnWindowFocus: true,
    // Today with an Open entry: its time is counted to now by the server.
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.date === d.today && d.summary.open ? LIVE_MS : false;
    },
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTeamDayLogs(date: string | undefined, enabled = true) {
  return useQuery<TeamDayLogResponse>({
    queryKey: dayLogKeys.team(date ?? ''),
    queryFn: () => apiFetch<TeamDayLogResponse>(`/day-logs/team${qs({ date })}`),
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.date === d.today ? LIVE_MS : false;
    },
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePersonDayLogs(userId: string, from: string, to: string) {
  return useQuery<PersonDayLogResponse>({
    queryKey: dayLogKeys.person(userId, from, to),
    queryFn: () => apiFetch<PersonDayLogResponse>(`/day-logs/person${qs({ userId, from, to })}`),
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });
}

/** SO / JWSO picker options (server-side search). */
export function useDayLogOrderOptions(search: string, enabled = true) {
  return useQuery<DayLogOrderOption[]>({
    queryKey: dayLogKeys.orders(search),
    queryFn: () =>
      apiFetch<DayLogOrderOption[]>(
        `/day-logs/order-options${qs({ search: search || undefined })}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
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

// ── Writes ──

/** A write that answers the day: the answer replaces that day in the cache
 *  (the screen redraws without a second round trip), then everything else
 *  under dayLogKeys.all is marked stale. */
function useDayWrite<TInput>(run: (input: TInput) => Promise<DayLogDetail>, q: DayQuery) {
  const qc = useQueryClient();
  return useMutation<DayLogDetail, Error, TInput>({
    mutationFn: run,
    onSuccess: (day) => {
      const shown = day.date === (q.date ?? day.today);
      if (shown) qc.setQueryData(dayLogKeys.day(q), day);
      const own = JSON.stringify(dayLogKeys.day(q));
      void qc.invalidateQueries({
        queryKey: dayLogKeys.all,
        predicate: (x) => !shown || JSON.stringify(x.queryKey) !== own,
      });
    },
  });
}

/** Add an entry. `saveKey`: one Idempotency-Key reused for every retry of
 *  the same save, so a double click or a resend after a timeout makes ONE
 *  entry (ADR-172 R2). */
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

/** Edit an entry; carries the updatedAt it was loaded with (§20.4). */
export function useUpdateDayLogEntry(q: DayQuery) {
  return useDayWrite<{ id: string } & UpdateDayLogEntryInput>(
    ({ id, ...input }) =>
      apiFetch<DayLogDetail>(`/day-logs/entries/${id}`, { method: 'PATCH', json: input }),
    q,
  );
}

/** ■ Stop an Open entry at the server's now. */
export function useStopDayLogEntry(q: DayQuery) {
  return useDayWrite<string>(
    (id) => apiFetch<DayLogDetail>(`/day-logs/entries/${id}/stop`, { method: 'POST' }),
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
