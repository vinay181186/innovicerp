// The two banners that stop a day before it starts:
//   blockedBy  — an earlier working day is still open (D3) → "Open <date>";
//   strayTimer — a timer left running on another day → set its end time,
//                pick its Work Status, Stop (timer/stop with endTime).
// Plus the Department Admin bar shown on someone else's day.

import type { DayLogDetail, DayLogWorkStatus } from '@innovic/shared';
import { DAY_LOG_WORK_STATUSES, DAY_LOG_WORK_STATUS_LABELS } from '@innovic/shared';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Banner } from '@/ui/feedback';
import { useDayLogAdminAction, useRemindDayLog, useStopDayLogTimer, type DayQuery } from '../api';
import { errText, parseHhmm } from '../lib/format';
import { ReasonDialog } from './day-dialogs';
import { TimeField } from './time-field';

export function BlockedNotice({
  day,
  onDate,
}: {
  day: DayLogDetail;
  onDate: (d: string) => void;
}): React.JSX.Element | null {
  if (!day.blockedBy) return null;
  const d = day.blockedBy.date;
  return (
    <Banner tone="warn" role="alert" title={day.blockedBy.reason}>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ marginTop: 6 }}
        onClick={() => onDate(d)}
      >
        Open {fmtDate(d)}
      </button>
    </Banner>
  );
}

export function StrayTimerNotice({
  day,
  q,
}: {
  day: DayLogDetail;
  q: DayQuery;
}): React.JSX.Element | null {
  const stop = useStopDayLogTimer(q);
  const [endTime, setEndTime] = useState('');
  const [status, setStatus] = useState<DayLogWorkStatus>('completed');
  const [err, setErr] = useState<string | null>(null);
  if (!day.strayTimer) return null;
  const t = day.strayTimer;
  const end = parseHhmm(endTime);
  return (
    <Banner
      tone="warn"
      role="alert"
      title={`Timer still running from ${fmtDate(t.date)} ${t.fromTime} — set its end time`}
    >
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}
      >
        <TimeField ariaLabel="End time" value={endTime} onChange={setEndTime} />
        <select
          className="innovic-select"
          aria-label="Work Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as DayLogWorkStatus)}
        >
          {DAY_LOG_WORK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {DAY_LOG_WORK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={!end || stop.isPending}
          onClick={() => {
            if (!end) return;
            setErr(null);
            stop.mutateAsync({ status, endTime: end }).catch((e: unknown) => setErr(errText(e)));
          }}
        >
          {stop.isPending ? 'Stopping…' : '■ Stop'}
        </button>
        {err ? <span style={{ color: 'var(--red2)' }}>{err}</span> : null}
      </div>
    </Banner>
  );
}

/** Reopen (submitted / leave) · Mark Leave (no work entries) · Send reminder
 *  (open day). Shown only when the server says canManage. */
export function AdminDayActions({
  day,
  q,
}: {
  day: DayLogDetail;
  q: DayQuery;
}): React.JSX.Element | null {
  const reopen = useDayLogAdminAction('reopen', q);
  const leave = useDayLogAdminAction('leave', q);
  const remind = useRemindDayLog();
  const [ask, setAsk] = useState<'reopen' | 'leave' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (!day.canManage || day.isOwner) return null;
  const hasWork = day.entries.some((e) => e.kind === 'work');
  const who = { userId: day.userId, date: day.date };
  return (
    <>
      {day.status !== 'open' ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={reopen.isPending}
          onClick={() => setAsk('reopen')}
        >
          Reopen day
        </button>
      ) : null}
      {day.status === 'open' && !hasWork ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={leave.isPending}
          onClick={() => setAsk('leave')}
        >
          Mark Leave
        </button>
      ) : null}
      {day.status === 'open' ? (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={remind.isPending}
          onClick={() => {
            setNote(null);
            remind.mutateAsync(who).then(
              () => setNote({ ok: true, text: `Reminder sent to ${day.userName}.` }),
              (e: unknown) => setNote({ ok: false, text: errText(e) }),
            );
          }}
        >
          {remind.isPending ? 'Sending…' : 'Send reminder'}
        </button>
      ) : null}
      {note ? (
        <span
          style={{ fontSize: 'var(--fs-xs)', color: note.ok ? 'var(--green2)' : 'var(--red2)' }}
        >
          {note.text}
        </span>
      ) : null}
      {ask ? (
        <ReasonDialog
          title={
            ask === 'reopen' ? `Reopen ${day.userName}'s day` : `Mark ${day.userName} on Leave`
          }
          message={
            ask === 'reopen'
              ? `${fmtDate(day.date)} opens again so ${day.userName} can correct it.`
              : `${fmtDate(day.date)} is recorded as Leave — no time is required.`
          }
          confirmLabel={ask === 'reopen' ? 'Reopen' : 'Mark Leave'}
          onConfirm={(reason) =>
            (ask === 'reopen' ? reopen : leave).mutateAsync({ ...who, reason })
          }
          onClose={() => setAsk(null)}
        />
      ) : null}
    </>
  );
}
