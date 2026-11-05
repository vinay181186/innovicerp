// "Pending Entries" tab (owner 2026-11-05), Super Admin only: one row per person with
// a working day not entered, oldest pending date first. The server sends one row per
// person + date (print and file keep those); this screen groups them. Search and the
// ADR-200 Sort & Filter ▾ run in the browser, as on Team Day Logs. A row click opens
// the person's calendar in a pop-up (Option D). No tile row.

import type { DayLogPendingRow } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { SearchInput } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { useDayLogAccess, usePendingEntries } from '../api';
import { pendingTable } from '../lib/export';
import { errText } from '../lib/format';
import { printPendingEntries } from '../lib/print-day-log';
import { PendingCalendar } from './pending-calendar';
import { PrintExportTools } from './print-export-tools';
import '../day-log-sheet.css';

type Row = {
  srNo: number;
  userId: string;
  userName: string;
  deptLabel: string | null;
  dates: string[];
  /** Pending dates with a reply. */
  repliedDates: number;
  unseenCount: number;
};

/** Reply Status for one person: how many of the dates have a reply, so one reply
 *  never hides the dates still waiting. */
function personReplyText(r: Row): string {
  if (r.repliedDates === 0) return 'Not replied';
  const seen = r.unseenCount > 0 ? 'Not seen' : 'Seen';
  return `Replied ${r.repliedDates} of ${r.dates.length} · ${seen}`;
}

/** The server's rows, oldest first, so the first date of a person is the oldest. */
function byPerson(rows: readonly DayLogPendingRow[]): Row[] {
  const people = new Map<string, Row>();
  for (const r of rows) {
    const p = people.get(r.userId) ?? {
      srNo: people.size + 1,
      userId: r.userId,
      userName: r.userName,
      deptLabel: r.deptLabel,
      dates: [],
      repliedDates: 0,
      unseenCount: 0,
    };
    p.dates.push(r.date);
    if (r.replyCount > 0) p.repliedDates += 1;
    p.unseenCount += r.unseenCount;
    people.set(r.userId, p);
  }
  return [...people.values()];
}

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'srNo', header: 'Sr No', kind: 'code', className: 'mono', render: (r) => r.srNo },
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
    id: 'department',
    header: 'Department',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (r) => r.deptLabel ?? '',
    filterValue: (r) => r.deptLabel ?? '',
    render: (r) => r.deptLabel ?? '—',
  },
  {
    id: 'pendingDates',
    header: 'Pending Dates',
    kind: 'num',
    align: 'right',
    className: 'mono fw-700',
    render: (r) => r.dates.length,
    filterValue: (r) => r.dates.length,
  },
  {
    id: 'oldestPendingDate',
    header: 'Oldest Pending Date',
    kind: 'date',
    className: 'mono',
    render: (r) => fmtDate(r.dates[0] ?? ''),
    filterValue: (r) => r.dates[0] ?? '',
  },
  {
    id: 'replyStatus',
    header: 'Reply Status',
    kind: 'text',
    render: personReplyText,
    filterValue: personReplyText,
  },
];

export function PendingEntriesTab(): React.JSX.Element {
  const access = useDayLogAccess();
  const allowed = Boolean(access.data?.canSeePending);
  const query = usePendingEntries(allowed);
  const [term, setTerm] = useState('');
  const [openUser, setOpenUser] = useState<string | null>(null);
  const data = query.data;
  const all = useMemo<Row[]>(() => byPerson(data?.rows ?? []), [data?.rows]);

  if (access.isSuccess && !allowed) {
    return <PageState state="noaccess" message="Pending Entries is for a Super Admin only." />;
  }
  if (!data) {
    const failed = access.error ?? query.error;
    return failed ? (
      <PageState state="error" message={errText(failed, 'Could not load the pending entries.')} />
    ) : (
      <PageState state="loading" />
    );
  }

  const needle = normalizeSearchTerm(term);
  const rows = needle
    ? all.filter((r) =>
        matchesSearchTerm(
          [r.userName, r.deptLabel, personReplyText(r), ...r.dates.map((d) => fmtDate(d))],
          needle,
        ),
      )
    : all;

  return (
    <div>
      <div className="dl-toolbar">
        <div className="dl-searchbar" role="search" style={{ marginBottom: 0 }}>
          <SearchInput value={term} onChange={setTerm} placeholder="Search User or Date…" />
          {needle ? (
            <span className="text3 dl-small">
              Showing {rows.length} of {all.length}
            </span>
          ) : null}
          {needle ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTerm('')}>
              Clear search
            </button>
          ) : null}
        </div>
        {query.isFetching ? <span className="text3">⟳ Updating…</span> : null}
        <span style={{ flex: 1 }} />
        <PrintExportTools
          table={pendingTable(data.rows)}
          fileName={`pending-entries-${data.today}`}
          sheetName="Pending Entries"
          onPrint={(company) => printPendingEntries(data, company)}
        />
      </div>
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <DataTable<Row>
        tableKey={TABLE_KEYS.dayLogPendingPeople}
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.userId}
        empty={needle ? 'No entries match.' : 'No pending entries.'}
        onRowClick={(r) => setOpenUser(r.userId)}
      />
      {openUser ? (
        <PendingCalendar key={openUser} userId={openUser} onClose={() => setOpenUser(null)} />
      ) : null}
    </div>
  );
}
