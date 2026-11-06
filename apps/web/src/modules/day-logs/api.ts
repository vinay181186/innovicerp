// Day Log data hooks (owner 2026-10-26; simple sheet final 2026-10-27). One
// hook per endpoint of /day-logs; every day write answers the whole day
// (DayLogDetail), so a write puts that answer straight into the day's cache
// and invalidates the rest of `dayLogKeys.all` (team table, person page).
// The screen shows the server's `summary` — it never works out the rules
// itself (CLAUDE.md §6 rule 1).

import type {
  AddDayLogEntriesInput,
  DayLogAccess,
  DayLogApprovalsResponse,
  DayLogDetail,
  DayLogHistory,
  DayLogHistoryQuery,
  DayLogMyPending,
  DayLogOrderOption,
  DayLogPendingCalendar,
  DayLogPendingResponse,
  DayLogPersonDay,
  Holiday,
  HolidayInput,
  DayLogRejectInput,
  DayLogTeamMatesResponse,
  DayLogTeamPeopleResponse,
  AddDayLogTeamMateInput,
  TeamDayLogResponse,
  UpdateDayLogEntryInput,
  UpdateDayLogWorkInput,
} from '@innovic/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { dashboardKeys, notificationKeys } from '@/modules/dashboard/api';
import { taskKeys } from '@/modules/tasks/api';

export interface DayQuery {
  date?: string | undefined;
  userId?: string | undefined;
}

/** The banner's own root (see pendingMine below). */
export const dayLogPendingKeys = { all: ['day-log-pending-mine'] as const };

export const dayLogKeys = {
  all: ['day-logs'] as const,
  access: () => [...dayLogKeys.all, 'access'] as const,
  day: (q: DayQuery) => [...dayLogKeys.all, 'day', q.date ?? '', q.userId ?? ''] as const,
  /** Every day of the Team Day Logs table (prefix of `team`). */
  teamAll: () => [...dayLogKeys.all, 'team'] as const,
  team: (date: string) => [...dayLogKeys.teamAll(), date] as const,
  /** Team Day Logs › a person, every day (prefix of `personDay`). */
  personDayAll: () => [...dayLogKeys.all, 'person-day'] as const,
  /** Team Day Logs › a person, one day (ADR-255). */
  personDay: (userId: string, date: string) =>
    [...dayLogKeys.personDayAll(), userId, date] as const,
  /** Teams Config: every user's team mates (prefix of `teamMates`). */
  teamMatesAll: () => [...dayLogKeys.all, 'team-mates'] as const,
  /** Teams Config: the chosen user's team mates (owner 2026-10-30). */
  teamMates: (userId: string) => [...dayLogKeys.teamMatesAll(), userId] as const,
  /** Teams Config pickers' people (under teamMatesAll, so every refresh of the
   *  team mates re-reads it too). */
  teamPeople: () => [...dayLogKeys.teamMatesAll(), 'people'] as const,
  orders: (search: string) => [...dayLogKeys.all, 'order-options', search] as const,
  holidays: () => [...dayLogKeys.all, 'holidays'] as const,
  approvals: () => [...dayLogKeys.all, 'approvals'] as const,
  /** The banner on every page: the caller's days not entered. Its own root,
   *  NOT under `all`: `all` re-reads on anyone's save, and the banner is open
   *  in every browser. Only the person's own save changes these dates. */
  pendingMine: () => dayLogPendingKeys.all,
  /** Pending Entries tab (Super Admin). */
  pending: () => [...dayLogKeys.all, 'pending'] as const,
  pendingCalendar: (userId: string) => [...dayLogKeys.all, 'pending-calendar', userId] as const,
  /** Team Day Logs › ⋯ History: one person's month or date (ADR-278). */
  history: (q: DayLogHistoryQuery) =>
    [...dayLogKeys.all, 'person-history', q.userId, q.month ?? '', q.date ?? ''] as const,
};

/** The team table reads again every minute (Working / Idle move on). */
const LIVE_MS = 60_000;

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Reads ──

export function useDayLogAccess(enabled = true) {
  return useQuery<DayLogAccess>({
    queryKey: dayLogKeys.access(),
    queryFn: () => apiFetch<DayLogAccess>('/day-logs/access'),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useDayLog(q: DayQuery, enabled = true) {
  return useQuery<DayLogDetail>({
    queryKey: dayLogKeys.day(q),
    queryFn: () => apiFetch<DayLogDetail>(`/day-logs/day${qs({ date: q.date, userId: q.userId })}`),
    refetchOnWindowFocus: true,
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

/** Team Day Logs › a person, one day: entries, and for a Super Admin every
 *  Working On revision and the replies (ADR-255). No date = the server's today. */
export function usePersonDay(userId: string, date: string | undefined) {
  return useQuery<DayLogPersonDay>({
    queryKey: dayLogKeys.personDay(userId, date ?? ''),
    queryFn: () => apiFetch<DayLogPersonDay>(`/day-logs/person-day${qs({ userId, date })}`),
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

/** Day Log edits waiting for the caller's approval (only when canApprove). */
export function useDayLogApprovals(enabled = true) {
  return useQuery<DayLogApprovalsResponse>({
    queryKey: dayLogKeys.approvals(),
    queryFn: () => apiFetch<DayLogApprovalsResponse>('/day-logs/approvals'),
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** Teams Config: the chosen user's team mates (Super Admin only). */
/** Teams Config pickers: active users whose Day Log is not hidden (Super Admin). */
export function useDayLogTeamPeople(enabled: boolean) {
  return useQuery<DayLogTeamPeopleResponse>({
    queryKey: dayLogKeys.teamPeople(),
    queryFn: () => apiFetch<DayLogTeamPeopleResponse>('/day-logs/team-mates/people'),
    enabled,
  });
}

export function useDayLogTeamMates(userId: string | null) {
  return useQuery<DayLogTeamMatesResponse>({
    queryKey: dayLogKeys.teamMates(userId ?? ''),
    queryFn: () =>
      apiFetch<DayLogTeamMatesResponse>(`/day-logs/team-mates${qs({ userId: userId ?? '' })}`),
    enabled: Boolean(userId),
  });
}

/** The caller's days not entered — the banner on every page. Refreshed by the
 *  caller's own save and on window focus (another tab, a new day, a holiday). */
export function useMyPendingDays(enabled = true) {
  return useQuery<DayLogMyPending>({
    queryKey: dayLogKeys.pendingMine(),
    queryFn: () => apiFetch<DayLogMyPending>('/day-logs/pending/mine'),
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** Pending Entries tab: everyone's days not entered (only when canSeePending). */
export function usePendingEntries(enabled = true) {
  return useQuery<DayLogPendingResponse>({
    queryKey: dayLogKeys.pending(),
    queryFn: () => apiFetch<DayLogPendingResponse>('/day-logs/pending'),
    refetchOnWindowFocus: true,
    enabled,
  });
}

/** Pending Entries › a person: the dates of their calendar pop-up. */
export function usePendingCalendar(userId: string) {
  return useQuery<DayLogPendingCalendar>({
    queryKey: dayLogKeys.pendingCalendar(userId),
    queryFn: () => apiFetch<DayLogPendingCalendar>(`/day-logs/pending/${userId}/calendar`),
    refetchOnWindowFocus: true,
  });
}

/** One person's History (ADR-278), always read fresh. Shared by the pop-up's
 *  count line and by Generate PDF's own read. */
export function dayLogHistoryQuery(q: DayLogHistoryQuery) {
  return {
    queryKey: dayLogKeys.history(q),
    queryFn: () =>
      apiFetch<DayLogHistory>(
        `/day-logs/person-history${qs({ userId: q.userId, month: q.month, date: q.date })}`,
      ),
    staleTime: 0,
  };
}

export function useDayLogHistory(q: DayLogHistoryQuery, enabled: boolean) {
  return useQuery<DayLogHistory>({ ...dayLogHistoryQuery(q), enabled });
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
      // The home "Daily report" widget counts today's finished entries; the
      // home 🔔 lists Day Log replies (ADR-255).
      void qc.invalidateQueries({ queryKey: dashboardKeys.widgets() });
      void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
      void qc.invalidateQueries({ queryKey: dayLogKeys.pendingMine() });
      // A saved entry closes that date's reply task and its notification.
      void qc.invalidateQueries({ queryKey: taskKeys.all });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Save the sheet's new rows together — all or nothing (the server answers
 *  "Row N: …" for the row it refused). `saveKey`: one Idempotency-Key reused
 *  for every retry of the same save, so a double click or a resend after a
 *  timeout saves the rows ONCE (ADR-172 R2). */
export function useAddDayLogEntries(q: DayQuery, saveKey?: SaveKey) {
  return useDayWrite<AddDayLogEntriesInput>(
    (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogDetail>('/day-logs/entries/batch', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    q,
  );
}

/** ADR-255 — the owner's DIRECT Working On edit (no approval); carries the
 *  entry's updatedAt (§20.4) and the form's Idempotency-Key (ADR-172). */
export function useUpdateDayLogWork(q: DayQuery, saveKey?: SaveKey) {
  return useDayWrite<{ id: string } & UpdateDayLogWorkInput>(
    ({ id, ...input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogDetail>(`/day-logs/entries/${id}/work`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    q,
  );
}

/** ADR-256 — edit Start / Stop / SO of a saved entry, saved DIRECTLY (no
 *  approval; a Super Admin sees the change on Team Day Logs); carries the
 *  updatedAt it was loaded with (§20.4). The server ignores `description` here (ADR-255) — send the current text. */
export function useUpdateDayLogEntry(q: DayQuery) {
  return useDayWrite<{ id: string } & UpdateDayLogEntryInput>(
    ({ id, ...input }) =>
      apiFetch<DayLogDetail>(`/day-logs/entries/${id}`, { method: 'PATCH', json: input }),
    q,
  );
}

/** Approve one staged edit (the new values apply). */
export function useApproveDayLogEdit() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; requestedAt: string }>({
    mutationFn: ({ id, requestedAt }) =>
      apiFetch(`/day-logs/entries/${id}/approve`, { method: 'POST', json: { requestedAt } }),
    // Success or a "someone got there first" refusal: re-read either way.
    onSettled: () => void qc.invalidateQueries({ queryKey: dayLogKeys.all }),
  });
}

/** Reject one staged edit with a reason (the row keeps its values). */
export function useRejectDayLogEdit() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & DayLogRejectInput>({
    mutationFn: ({ id, ...input }) =>
      apiFetch(`/day-logs/entries/${id}/reject`, { method: 'POST', json: input }),
    onSettled: () => void qc.invalidateQueries({ queryKey: dayLogKeys.all }),
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

/** After a Teams Config write: the pair lists, who may open Team Day Logs
 *  (access), the Team Day Logs table and the person pages it gates. */
function useAfterTeamWrite(): () => void {
  const qc = useQueryClient();
  return () => {
    for (const queryKey of [
      dayLogKeys.teamMatesAll(),
      dayLogKeys.access(),
      dayLogKeys.teamAll(),
      dayLogKeys.personDayAll(),
    ]) {
      void qc.invalidateQueries({ queryKey });
    }
  };
}

/** Teams Config › + Add: the User now sees the team mate (one-way). One click
 *  = one row (`saveKey`, ADR-172); 409 when that User → mate is already set. */
export function useAddDayLogTeamMate(saveKey?: SaveKey) {
  const after = useAfterTeamWrite();
  return useMutation<unknown, Error, AddDayLogTeamMateInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch('/day-logs/team-mates', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: after,
  });
}

/** Teams Config › ⋯ Remove team mate (the pair row id); 409 when already removed. */
export function useRemoveDayLogTeamMate() {
  const after = useAfterTeamWrite();
  return useMutation<unknown, Error, string>({
    mutationFn: (id) => apiFetch(`/day-logs/team-mates/${id}`, { method: 'DELETE' }),
    // Removed, or someone removed it first (409): re-read either way.
    onSettled: after,
  });
}
