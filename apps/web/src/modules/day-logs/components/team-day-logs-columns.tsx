// Team Day Logs — the FIT table's columns (ADR-199): User · First start ·
// Last stop · Working hours · Entries (no Now / Late, owner 2026-10-30). Each column gives the ADR-200
// Sort & Filter a real value (times as HH:MM, hours as minutes) so ▾ sorts by
// the fact, not by the shown text.

import type { TeamDayLogRow } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';

export function teamColumns(): DataTableColumn<TeamDayLogRow>[] {
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
  ];
}
