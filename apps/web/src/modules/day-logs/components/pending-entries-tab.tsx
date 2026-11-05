// "Pending Entries" tab (owner 2026-11-05), Super Admin only: one row per person
// and working day with no Day Log entry, oldest first. The server sends the whole
// list, so search and the ADR-200 Sort & Filter ▾ run in the browser, as on Team
// Day Logs. A row click or ⋯ Reply opens the person page on that date, where the
// Super Admin replies. No tile row.

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
import { pendingTable, replyStateText } from '../lib/export';
import { errText, weekday } from '../lib/format';
import { printPendingEntries } from '../lib/print-day-log';
import { PrintExportTools } from './print-export-tools';
import '../day-log-sheet.css';

type Row = DayLogPendingRow & { srNo: number };

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
    id: 'pendingDate',
    header: 'Pending Date',
    kind: 'date',
    className: 'mono fw-700',
    render: (r) => fmtDate(r.date),
    filterValue: (r) => r.date,
  },
  { id: 'day', header: 'Day', kind: 'code', render: (r) => weekday(r.date) },
  {
    id: 'daysPending',
    header: 'Days Pending',
    kind: 'num',
    align: 'right',
    className: 'mono',
    render: (r) => r.daysPending,
    filterValue: (r) => r.daysPending,
  },
  {
    id: 'taskNo',
    header: 'Task No.',
    kind: 'code',
    className: 'td-code',
    render: (r) => r.taskCode ?? '—',
    filterValue: (r) => r.taskCode ?? '',
  },
  {
    id: 'replyStatus',
    header: 'Reply Status',
    kind: 'text',
    render: replyStateText,
    filterValue: replyStateText,
  },
];

export function PendingEntriesTab({
  onOpen,
}: {
  onOpen: (userId: string, date: string) => void;
}): React.JSX.Element {
  const access = useDayLogAccess();
  const allowed = Boolean(access.data?.canSeePending);
  const query = usePendingEntries(allowed);
  const [term, setTerm] = useState('');
  const data = query.data;
  const all = useMemo<Row[]>(
    () => (data?.rows ?? []).map((r, i) => ({ ...r, srNo: i + 1 })),
    [data?.rows],
  );

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
          [
            r.userName,
            r.deptLabel,
            fmtDate(r.date),
            weekday(r.date),
            r.taskCode,
            replyStateText(r),
          ],
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
        tableKey={TABLE_KEYS.dayLogPending}
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => `${r.userId}:${r.date}`}
        empty={needle ? 'No entries match.' : 'No pending entries.'}
        onRowClick={(r) => onOpen(r.userId, r.date)}
        rowMenuLabel={(r) => `Actions for ${r.userName} ${fmtDate(r.date)}`}
        rowMenu={(r) => [
          {
            key: 'reply',
            label: 'Reply',
            icon: 'pencil',
            onSelect: () => onOpen(r.userId, r.date),
          },
        ]}
      />
    </div>
  );
}
