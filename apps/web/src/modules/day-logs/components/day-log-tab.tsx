// "My Day Log" tab of the Task Board (design approved 2026-10-26). One day
// of the signed-in user: Day select + Today + day chip + Submit Day, ONE
// summary strip (server figures), the blocked / stray-open banners, the ONE
// entry form and the entries table.
//
// Every write follows the SERVER's canWrite, never useCanWrite(): a
// view-only L1 user still logs their own day. A day the server does not let
// the user write (past, submitted) is read-only: no form, no actions.

import type { DayLogEntry } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import {
  useDayLog,
  useDayLogAccess,
  useRemoveDayLogEntry,
  useStopDayLogEntry,
  useSubmitDayLog,
  type DayQuery,
} from '../api';
import { dayTable, fileSlug } from '../lib/export';
import { dayChip, errText, liveNowMin } from '../lib/format';
import { printDayLog } from '../lib/print-day-log';
import { DaySelect, DaySummaryStrip } from './day-header';
import { BlockedNotice, StrayOpenNotice } from './day-notices';
import { EntriesTable } from './entries-table';
import { EntryForm } from './entry-form';
import { HolidaysModal } from './holidays-modal';
import { PrintExportTools } from './print-export-tools';

export function DayLogTab({
  date,
  onDate,
}: {
  date: string | undefined;
  onDate: (d: string | undefined) => void;
}): React.JSX.Element {
  const q: DayQuery = { date };
  const query = useDayLog(q);
  const access = useDayLogAccess();
  const submit = useSubmitDayLog(q);
  const stop = useStopDayLogEntry(q);
  const remove = useRemoveDayLogEntry(q);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The stray-open banner: open that day, then edit that entry once it loads.
  const [pendingEdit, setPendingEdit] = useState<{ date: string; id: string } | null>(null);
  const [modal, setModal] = useState<'submit' | 'holidays' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Re-draw every 30 s so the picker's "after now" limit and Now stay current.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const day = query.data;
  const placeholder = query.isPlaceholderData;
  useEffect(() => {
    if (!pendingEdit || !day || placeholder || day.date !== pendingEdit.date) return;
    if (day.entries.some((e) => e.id === pendingEdit.id)) setEditingId(pendingEdit.id);
    setPendingEdit(null);
  }, [pendingEdit, placeholder, day]);

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
  const nowMin = isToday ? liveNowMin(day.nowTime, query.dataUpdatedAt, tick) : null;
  // While another day is loading the old one stays on screen — no writes then.
  const canWrite = day.canWrite && !query.isPlaceholderData;
  const editing = day.entries.find((e) => e.id === editingId) ?? null;
  // Strict order: only the server's last entry may change its times / be removed.
  const lastId = day.lastEntryId;
  const chip = dayChip(day.status, isToday);
  const canSubmit = day.summary.unloggedMin === 0 && !day.summary.open;
  const busy = stop.isPending || remove.isPending;

  const goDate = (d: string): void => {
    setEditingId(null);
    setErr(null);
    onDate(d === day.today ? undefined : d);
  };
  const run = (p: Promise<unknown>): void => {
    setErr(null);
    p.catch((e: unknown) => setErr(errText(e)));
  };

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <label className="text3" htmlFor="dl-day">
          Day
        </label>
        <DaySelect id="dl-day" value={day.date} today={day.today} onChange={goDate} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={isToday}
          onClick={() => goDate(day.today)}
        >
          Today
        </button>
        <span className={`badge ${chip.cls}`}>{chip.label}</span>
        {!day.workingDay ? (
          <span className="badge b-grey">{day.holidayName ?? 'Not a working day'}</span>
        ) : null}
        <span style={{ flex: 1 }} />
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
        {day.canWrite ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canWrite || !canSubmit || submit.isPending}
            onClick={() => setModal('submit')}
          >
            Submit Day
          </button>
        ) : null}
      </div>

      <DaySummaryStrip s={day.summary} />

      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <BlockedNotice day={day} onDate={goDate} />
      <StrayOpenNotice
        day={day}
        onEdit={(d, id) => {
          setPendingEdit({ date: d, id });
          goDate(d);
        }}
      />

      {canWrite ? (
        <EntryForm
          key={`${day.date}:${editing?.id ?? 'new'}`}
          day={day}
          q={q}
          nowMin={nowMin}
          editing={editing}
          isLast={editing !== null && editing.id === lastId}
          onDone={() => setEditingId(null)}
        />
      ) : null}

      {err ? (
        <Banner tone="error" onDismiss={() => setErr(null)}>
          {err}
        </Banner>
      ) : null}

      <div className="panel" style={{ padding: 0, marginBottom: 10 }}>
        <EntriesTable
          date={day.date}
          entries={day.entries}
          actions={
            canWrite
              ? {
                  busy,
                  editingId,
                  lastId,
                  onStop: isToday ? (e: DayLogEntry) => run(stop.mutateAsync(e.id)) : null,
                  onEdit: (e: DayLogEntry) => {
                    setErr(null);
                    setEditingId(e.id);
                  },
                  onRemove: (e: DayLogEntry) => {
                    if (editingId === e.id) setEditingId(null);
                    run(remove.mutateAsync(e.id));
                  },
                }
              : null
          }
        />
      </div>

      {modal === 'submit' ? (
        <ConfirmDialog
          title="Submit this day?"
          message="The day is locked once submitted."
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
      {modal === 'holidays' ? <HolidaysModal onClose={() => setModal(null)} /> : null}
    </div>
  );
}
