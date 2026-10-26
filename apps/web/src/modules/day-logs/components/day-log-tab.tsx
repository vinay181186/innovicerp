// "My Day Log" tab of the Task Board (owner 2026-10-26). One day of one
// person: header + counts (server summary), the blocked / stray-timer
// banners, the 09:00–18:00 bar, the S1 timer bar (own day, today), the
// entries table with "Add time by hand" under it, and Submit Day.
//
// Every write button follows the SERVER's canWrite / canManage, never
// useCanWrite(): a view-only L1 user still logs their own day. `?user=`
// opens someone else's day read-only (+ Department Admin actions).

import type { DayLogEntry, DayLogWorkStatus } from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { useDayLog, useDayLogAccess, useSubmitDayLog, type DayQuery } from '../api';
import { fileSlug, dayTable } from '../lib/export';
import { errText, liveNowHhmm, liveNowMin, taskCode } from '../lib/format';
import { printDayLog } from '../lib/print-day-log';
import { CompleteTaskDialog } from './day-dialogs';
import { DayHeader } from './day-header';
import { AdminDayActions, BlockedNotice, StrayTimerNotice } from './day-notices';
import { DayTimeline } from './day-timeline';
import { EntriesTable } from './entries-table';
import { HandEntryForm } from './hand-entry-form';
import { HolidaysModal } from './holidays-modal';
import { MyBreaksModal } from './my-breaks-modal';
import { PrintExportTools } from './print-export-tools';
import { TimerBar, type TimerDraft } from './timer-bar';

const TICK_MS = 30_000;
const EMPTY_DRAFT: TimerDraft = { description: '', taskId: null, taskLabel: null };

export function DayLogTab({
  date,
  userId,
  onDate,
  onUser,
}: {
  date: string | undefined;
  userId: string | undefined;
  onDate: (d: string | undefined) => void;
  onUser: (u: string | undefined) => void;
}): React.JSX.Element {
  const q: DayQuery = { date, userId };
  const query = useDayLog(q);
  const access = useDayLogAccess();
  const submit = useSubmitDayLog(q);
  const [tick, setTick] = useState(() => Date.now());
  const [draft, setDraft] = useState<TimerDraft>(EMPTY_DRAFT);
  const [handTo, setHandTo] = useState('');
  const [askTask, setAskTask] = useState<{ taskId: string; code: string } | null>(null);
  const [taskNote, setTaskNote] = useState<string | null>(null);
  const [modal, setModal] = useState<'submit' | 'breaks' | 'holidays' | null>(null);
  const handToRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const day = query.data;
  if (query.isLoading || !day) {
    return (
      <div
        className="empty-state"
        style={{ padding: 40, color: query.isError ? 'var(--red2)' : undefined }}
      >
        {query.isError ? errText(query.error, 'Could not load the day log.') : 'Loading…'}
      </div>
    );
  }

  const isToday = day.date === day.today;
  const nowMin = isToday ? liveNowMin(day.nowTime, query.dataUpdatedAt, tick) : 24 * 60;
  const running = day.summary.running;
  // While another day is loading the old one stays on screen — no writes then.
  const blocked = Boolean(day.blockedBy || day.strayTimer) || query.isPlaceholderData;
  const showTimer = day.canWrite && isToday && !blocked;
  const showHand = day.canWrite && !running && !blocked;
  const canSubmit =
    day.canWrite && day.summary.missingMin === 0 && !running && !query.isPlaceholderData;

  /** D6: a Completed entry linked to a task asks to complete the task too. */
  const afterStatus = (s: DayLogWorkStatus, taskId: string | null, label: string | null): void => {
    if (s === 'completed' && taskId) setAskTask({ taskId, code: taskCode(label) || 'the task' });
  };
  const fillTo = (hhmm: string): void => {
    setHandTo(hhmm);
    handToRef.current?.focus();
  };

  return (
    <div>
      <DayHeader
        day={day}
        onDate={onDate}
        tools={
          <>
            {userId && !day.isOwner ? (
              <button type="button" className="btn btn-ghost" onClick={() => onUser(undefined)}>
                ← My Day Log
              </button>
            ) : null}
            <AdminDayActions day={day} q={q} />
            {day.isOwner ? (
              <button type="button" className="btn btn-ghost" onClick={() => setModal('breaks')}>
                My Break Time
              </button>
            ) : null}
            {access.data?.canManageHolidays ? (
              <button type="button" className="btn btn-ghost" onClick={() => setModal('holidays')}>
                Holidays
              </button>
            ) : null}
            <PrintExportTools
              table={dayTable(day)}
              fileName={`day-log-${fileSlug(day.userName)}-${day.date}`}
              sheetName="Day Log"
              onPrint={(company) => printDayLog(day, company)}
            />
          </>
        }
      />

      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <BlockedNotice day={day} onDate={(d) => onDate(d === day.today ? undefined : d)} />
      <StrayTimerNotice day={day} q={q} />
      {taskNote ? (
        <Banner tone="info" onDismiss={() => setTaskNote(null)}>
          {taskNote}
        </Banner>
      ) : null}

      <DayTimeline
        entries={day.entries}
        workFrom={day.workFrom}
        workTo={day.workTo}
        nowMin={nowMin}
        onPickHour={showHand ? fillTo : undefined}
      />

      {showTimer ? (
        <TimerBar
          day={day}
          q={q}
          nowMin={nowMin}
          draft={draft}
          onDraft={setDraft}
          onLogByHand={() => fillTo(liveNowHhmm(day.nowTime, query.dataUpdatedAt, tick))}
          onStopped={(s, taskId, label) => {
            setDraft(EMPTY_DRAFT);
            afterStatus(s, taskId, label);
          }}
        />
      ) : null}

      <EntriesTable
        day={day}
        q={q}
        canContinue={showTimer}
        onContinue={(e: DayLogEntry) =>
          setDraft({ description: e.description, taskId: e.taskId, taskLabel: e.taskLabel })
        }
        onStatusSet={(s, e) => afterStatus(s, e.taskId, e.taskLabel)}
      >
        {showHand ? (
          <HandEntryForm
            ref={handToRef}
            day={day}
            q={q}
            toTime={handTo}
            onToTime={setHandTo}
            onSaved={(s, taskId, label) => {
              setHandTo('');
              afterStatus(s, taskId, label);
            }}
          />
        ) : null}
      </EntriesTable>

      {day.canWrite ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
          <span className="text3" style={{ fontSize: 13 }}>
            {running
              ? 'Stop the timer to submit the day.'
              : day.summary.missingMin > 0
                ? `Log ${day.summary.nextFrom} – ${day.workTo} to submit the day.`
                : 'All required time logged.'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || submit.isPending}
            onClick={() => setModal('submit')}
          >
            Submit Day
          </button>
        </div>
      ) : null}

      {modal === 'submit' ? (
        <ConfirmDialog
          title="Submit this day?"
          message="The day is locked once submitted. Only your Department Admin can reopen it."
          confirmLabel="Submit Day"
          pendingLabel="Submitting…"
          tone="primary"
          onCancel={() => setModal(null)}
          onConfirm={async () => {
            await submit.mutateAsync({ date: day.date });
            setModal(null);
          }}
        />
      ) : null}
      {modal === 'breaks' ? <MyBreaksModal onClose={() => setModal(null)} /> : null}
      {modal === 'holidays' ? <HolidaysModal onClose={() => setModal(null)} /> : null}
      {askTask ? (
        <CompleteTaskDialog
          taskId={askTask.taskId}
          code={askTask.code}
          onClose={(msg) => {
            setAskTask(null);
            setTaskNote(msg);
          }}
        />
      ) : null}
    </div>
  );
}
