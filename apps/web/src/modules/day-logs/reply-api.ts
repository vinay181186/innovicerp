// Day Log reply hooks: Super Admin replies on an entry (ADR-255) and on a blank
// day (owner 2026-11-05), and the owner's "seen" marks. Keys: dayLogKeys (api.ts).

import type {
  DayLogAdminReply,
  EditDayLogReplyInput,
  SendDayLogDayReplyInput,
  SendDayLogReplyInput,
} from '@innovic/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { dashboardKeys, notificationKeys } from '@/modules/dashboard/api';
import { taskKeys } from '@/modules/tasks/api';
import { dayLogKeys } from './api';

/** Refresh every Day Log screen, the home 🔔, the task board and the
 *  notifications after a reply write (a reply on a blank day raises a task). */
function useAfterReply(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: dayLogKeys.all });
    void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
    void qc.invalidateQueries({ queryKey: taskKeys.all });
    void qc.invalidateQueries({ queryKey: notificationKeys.all });
  };
}

/** ADR-255 — the owner opened an entry with unread replies: they are seen
 *  (the row's 🔔 goes, the Super Admin sees "Seen by"). Idempotent. */
export function useMarkDayLogRepliesSeen() {
  const after = useAfterReply();
  return useMutation<{ seen: number }, Error, string>({
    mutationFn: (entryId) =>
      apiFetch<{ seen: number }>(`/day-logs/entries/${entryId}/replies/seen`, { method: 'POST' }),
    onSuccess: after,
  });
}

/** A reply write carries the key of the form that sent it (one form = one
 *  Idempotency-Key, ADR-172), so an entry's pane and a day's pane share one UI. */
interface WithSaveKey {
  saveKey: SaveKey;
}

/** ADR-255 — Super Admin replies on an entry; one click = one reply. */
export function useSendDayLogReply() {
  const after = useAfterReply();
  return useMutation<
    DayLogAdminReply,
    Error,
    { entryId: string } & SendDayLogReplyInput & WithSaveKey
  >({
    mutationFn: ({ entryId, saveKey, ...input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogAdminReply>(`/day-logs/entries/${entryId}/replies`, {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: after,
  });
}

/** ADR-255 — Super Admin edits a reply (§20.4 updatedAt; the owner sees it
 *  as unread again). */
export function useEditDayLogReply() {
  const after = useAfterReply();
  return useMutation<
    DayLogAdminReply,
    Error,
    { replyId: string } & EditDayLogReplyInput & WithSaveKey
  >({
    mutationFn: ({ replyId, saveKey, ...input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogAdminReply>(`/day-logs/replies/${replyId}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: after,
  });
}

/** Super Admin replies on a person's blank day; one click = one reply. */
export function useSendDayLogDayReply() {
  const after = useAfterReply();
  return useMutation<DayLogAdminReply, Error, SendDayLogDayReplyInput & WithSaveKey>({
    mutationFn: ({ saveKey, ...input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogAdminReply>('/day-logs/day-replies', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: after,
  });
}

/** Super Admin edits a reply on a blank day (§20.4 updatedAt). */
export function useEditDayLogDayReply() {
  const after = useAfterReply();
  return useMutation<
    DayLogAdminReply,
    Error,
    { replyId: string } & EditDayLogReplyInput & WithSaveKey
  >({
    mutationFn: ({ replyId, saveKey, ...input }) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<DayLogAdminReply>(`/day-logs/day-replies/${replyId}`, {
          method: 'PATCH',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: after,
  });
}

/** The owner opened a date with unread replies on the day: they are seen. Idempotent. */
export function useMarkDayLogDayRepliesSeen() {
  const after = useAfterReply();
  return useMutation<{ seen: number }, Error, string>({
    mutationFn: (date) =>
      apiFetch<{ seen: number }>('/day-logs/day-replies/seen', {
        method: 'POST',
        json: { date },
      }),
    onSuccess: after,
  });
}
