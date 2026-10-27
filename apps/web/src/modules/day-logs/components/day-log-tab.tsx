// "My Day Log" tab of the Task Board (simple sheet, owner final 2026-10-27).
// One day of the signed-in user: Day select + Today (+ Holidays for whoever
// manages them, Print / Export), ONE summary strip (Working hours · First
// start · Last stop · Entries — server figures), the blocked banner, and the
// ONE sheet (saved rows, then new rows, one Save — day-sheet.tsx).
//
// Every write follows the SERVER's canWrite, never useCanWrite(): a
// view-only L1 user still logs their own day. A blocked day (blockedBy)
// takes no new rows.

import { useCallback, useEffect, useState } from 'react';
import { Banner } from '@/ui/feedback';
import { useDayLog, useDayLogAccess, type DayQuery } from '../api';
import { dayTable, fileSlug } from '../lib/export';
import { errText, liveNowMin } from '../lib/format';
import { printDayLog } from '../lib/print-day-log';
import { DaySelect, DaySummaryStrip } from './day-header';
import { BlockedNotice } from './day-notices';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [holidays, setHolidays] = useState(false);
  // The sheet has typed, unsaved rows — leaving the day asks first.
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);
  // Re-draw every 30 s so the picker's "after now" limit and Now stay current.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
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
  const nowMin = isToday ? liveNowMin(day.nowTime, query.dataUpdatedAt, tick) : null;
  // While another day is loading the old one stays on screen — no writes then.
  const canWrite = day.canWrite && !query.isPlaceholderData;
  const canAdd = canWrite && !day.blockedBy;

  const goDate = (d: string): void => {
    if (dirty && !window.confirm('You have rows that are not saved. Leave this day and lose them?'))
      return;
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
        {!day.workingDay ? (
          <span className="badge b-grey">{day.holidayName ?? 'Not a working day'}</span>
        ) : null}
        <span style={{ flex: 1 }} />
        {access.data?.canManageHolidays ? (
          <button type="button" className="btn btn-ghost" onClick={() => setHolidays(true)}>
            Holidays
          </button>
        ) : null}
        <PrintExportTools
          table={dayTable(day)}
          fileName={`day-log-${fileSlug(day.userName)}-${day.date}`}
          sheetName="Day Log"
          onPrint={(company) => printDayLog(day, company)}
        />
      </div>

      <DaySummaryStrip s={day.summary} />

      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <BlockedNotice day={day} onDate={goDate} />

      <DaySheet
        key={day.date}
        day={day}
        q={q}
        nowMin={nowMin}
        canWrite={canWrite}
        canAdd={canAdd}
        editingId={editingId}
        onEditingId={setEditingId}
        onDirty={onDirty}
      />

      {holidays ? <HolidaysModal onClose={() => setHolidays(false)} /> : null}
    </div>
  );
}
