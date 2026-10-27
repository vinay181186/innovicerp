// "My Day Log" tab of the Task Board (design approved 2026-10-26; one-sheet
// layout approved 2026-10-27). One day of the signed-in user: Day select +
// Today + day chip + Submit Day, ONE summary strip (server figures), the
// blocked / stray-open banners, and the ONE sheet (saved rows, then new rows,
// one Save — day-sheet.tsx).
//
// Every write follows the SERVER's canWrite, never useCanWrite(): a
// view-only L1 user still logs their own day. A day the server does not let
// the user write (past, submitted) is read-only: no new rows, no actions.

import { DAY_LOG_RULES, fmt12 } from '@innovic/shared';
import { useCallback, useEffect, useState } from 'react';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { useDayLog, useDayLogAccess, useSubmitDayLog, type DayQuery } from '../api';
import { dayTable, fileSlug } from '../lib/export';
import { dayChip, errText, liveNowMin } from '../lib/format';
import { printDayLog } from '../lib/print-day-log';
import { DaySelect, DaySummaryStrip } from './day-header';
import { BlockedNotice, StrayOpenNotice } from './day-notices';
import { DaySheet } from './day-sheet';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  // The stray-open banner: open that day, then edit that entry once it loads.
  const [pendingEdit, setPendingEdit] = useState<{ date: string; id: string } | null>(null);
  const [modal, setModal] = useState<'submit' | 'holidays' | null>(null);
  // The sheet has typed, unsaved rows — Submit Day waits for them.
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);
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
  const chip = dayChip(day.status, isToday);
  const canSubmit = day.summary.unloggedMin === 0 && !day.summary.open && !dirty;

  const goDate = (d: string): void => {
    setEditingId(null);
    onDate(d === day.today ? undefined : d);
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
            title={
              dirty
                ? 'Save or drop the new rows first'
                : day.summary.open
                  ? 'Stop the open row first'
                  : day.summary.unloggedMin > 0
                    ? `${day.summary.unloggedMin} min of ${fmt12(DAY_LOG_RULES.workFrom)} – ${fmt12(DAY_LOG_RULES.workTo)} not logged yet`
                    : undefined
            }
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

      <DaySheet
        key={day.date}
        day={day}
        q={q}
        nowMin={nowMin}
        canWrite={canWrite}
        editingId={editingId}
        onEditingId={setEditingId}
        onDirty={onDirty}
      />

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
