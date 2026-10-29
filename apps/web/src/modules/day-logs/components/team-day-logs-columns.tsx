// Team Day Logs — the FIT table's columns (ADR-199): User · Now · First start
// · Last stop · Working hours · Entries · Late. Each column gives the ADR-200
// Sort & Filter a real value (times as HH:MM, hours as minutes) so ▾ sorts by
// the fact, not by the shown text.

import type { TeamDayLogRow } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';
import { nowChip } from '../lib/format';

export function NowCell({
  row,
  isToday,
}: {
  row: Pick<TeamDayLogRow, 'currentStatus' | 'currentText' | 'entryCount'>;
  isToday: boolean;
}): React.JSX.Element {
  const c = nowChip(row, isToday);
  const text = isToday ? row.currentText : null;
  return (
    <>
      <span className={`badge ${c.cls}`}>{c.label}</span>
      {text ? (
        <span className="text3" style={{ marginLeft: 6 }}>
          {text}
        </span>
      ) : null}
    </>
  );
}

export function teamColumns(isToday: boolean): DataTableColumn<TeamDayLogRow>[] {
  return [
    {
      id: 'user',
      header: 'User',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      title: (r) => r.userName,
      filterValue: (r) => r.userName,
      render: (r) => <span style={{ color: 'var(--blue)' }}>{r.userName}</span>,
    },
    {
      id: 'now',
      header: 'Now',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      title: (r) =>
        [nowChip(r, isToday).label, isToday ? r.currentText : null].filter(Boolean).join(' · '),
      filterValue: (r) => nowChip(r, isToday).label,
      render: (r) => <NowCell row={r} isToday={isToday} />,
    },
    {
      id: 'firstStart',
      header: 'First start',
      kind: 'date',
      className: 'mono',
      render: (r) => fmt12(r.firstStart),
      filterValue: (r) => r.firstStart,
    },
    {
      id: 'lastStop',
      header: 'Last stop',
      kind: 'date',
      className: 'mono',
      render: (r) => fmt12(r.lastStop),
      filterValue: (r) => r.lastStop,
    },
    {
      id: 'workHours',
      header: 'Working hours',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      render: (r) => fmtDuration(r.workMin),
      filterValue: (r) => r.workMin,
    },
    {
      id: 'entries',
      header: 'Entries',
      kind: 'num',
      align: 'right',
      className: 'mono',
      render: (r) => r.entryCount,
      filterValue: (r) => r.entryCount,
    },
    {
      id: 'late',
      header: 'Late',
      kind: 'badge',
      render: (r) =>
        r.lateCount > 0 ? <span className="badge b-orange">{r.lateCount} LATE</span> : '—',
      filterValue: (r) => r.lateCount,
    },
  ];
}
