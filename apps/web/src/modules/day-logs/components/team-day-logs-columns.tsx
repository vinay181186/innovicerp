// Team Day Logs — the FIT table's columns (ADR-199): User · First start ·
// Last stop · Working hours · Entries (no Now / Late, owner 2026-10-30). Each column gives the ADR-200
// Sort & Filter a real value (times as HH:MM, hours as minutes) so ▾ sorts by
// the fact, not by the shown text.

import type { TeamDayLogRow } from '@innovic/shared';
import { DAY_LOG_STATUS_LABELS, fmt12, fmtDuration, leaveText } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';
import { srNoColumn } from '@/ui/data/lead-columns';

export function teamColumns(): DataTableColumn<TeamDayLogRow>[] {
  return [
    // One unpaged list (the whole team for the day), so Sr No starts at 1.
    srNoColumn<TeamDayLogRow>(1),
    {
      id: 'user',
      header: 'User',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      title: (r) => r.userName,
      filterValue: (r) => r.userName,
      render: (r) => (
        <>
          <span style={{ color: 'var(--blue)' }}>{r.userName}</span>
          {r.notEntered ? (
            <span className="badge b-orange dl-userbadge">
              {r.dayReplyCount > 0 ? 'Not entered · replied' : 'Not entered'}
            </span>
          ) : null}
          {/* Full Day: "Personal Leave"; Half Day: "Half Day Leave 01:00 PM –
              06:00 PM" — the rest of the row stays the normal day. */}
          {r.status === 'leave' ? (
            <span className="badge b-grey dl-userbadge">
              {r.leaveKind === 'half'
                ? leaveText(r.leaveKind, r.leaveFrom, r.leaveTo)
                : DAY_LOG_STATUS_LABELS.leave}
            </span>
          ) : null}
        </>
      ),
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
