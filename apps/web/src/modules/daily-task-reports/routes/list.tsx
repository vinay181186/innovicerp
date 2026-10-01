// Daily Task Reports — mirror of legacy renderDailyReports (HTML L14141).
// User-submitted "what I did today" reports. Admin / manager see all + a user filter;
// everyone else sees only their own (server-filtered) and may file/edit their own.

import { SHIFT_LABELS, type DailyTaskReportRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';
import { useDailyReportList } from '../api';
import { ReportLinesExpand } from '../components/report-lines-expand';
import { EditReportModal, NewReportModal, ViewReportModal } from '../components/report-modals';

export const dailyTaskReportsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'daily-task-reports',
  component: DailyTaskReportsPage,
});

type ModalState =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'edit'; id: string }
  | { kind: 'view'; id: string };

function DailyTaskReportsPage(): React.JSX.Element {
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [term, setTerm] = useState('');
  // The row's ▸ (fit engine) reveals that report's task lines. A Set — many open.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { data, isLoading, isFetching, isError, error } = useDailyReportList({
    userId: userFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load daily reports. Try again.'}
      </div>
    );
  }

  // Client-side search over the rows loaded — the three text columns.
  const rows = data.reports.filter((r) =>
    matchesSearchTerm([fmtDate(r.reportDate), r.userName, SHIFT_LABELS[r.shift]], term),
  );

  const columns: DataTableColumn<DailyTaskReportRow>[] = [
    {
      id: 'report_date',
      kind: 'date',
      header: 'Report Date',
      className: 'fw-700',
      nowrap: true,
      render: (r) => fmtDate(r.reportDate),
    },
    {
      id: 'user',
      kind: 'text',
      header: 'User',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (r) => r.userName ?? '—',
      title: (r) => r.userName ?? '',
    },
    {
      id: 'shift',
      header: 'Shift',
      nowrap: true,
      render: (r) => SHIFT_LABELS[r.shift],
    },
    {
      id: 'tasks',
      header: 'Tasks',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => r.taskCount,
    },
    {
      id: 'hours',
      header: 'Hours',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.totalHours.toFixed(1)}h</span>,
    },
  ];

  return (
    <div>
      <ListHeader
        title="Daily Task Reports"
        icon="📝"
        count={rows.length}
        noun="report"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search report date, user, shift…"
        updating={isFetching}
        filters={
          <>
            {data.canSeeAll ? (
              <select
                className="innovic-select"
                aria-label="User"
                title="User"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Users</option>
                {data.userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="date"
              className="innovic-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Report date from"
              aria-label="Report date from"
            />
            <input
              type="date"
              className="innovic-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Report date to"
              aria-label="Report date to"
            />
          </>
        }
        onClearFilters={() => {
          setUserFilter('');
          setDateFrom('');
          setDateTo('');
          setTerm('');
        }}
        filtersActive={userFilter !== '' || dateFrom !== '' || dateTo !== '' || term.trim() !== ''}
        primary={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'new' })}
          >
            + New Report
          </button>
        }
      />

      <Panel bodyPadding="none">
        <DataTable<DailyTaskReportRow>
          tableKey={TABLE_KEYS.dailyTaskReports}
          columns={columns}
          rows={rows}
          empty={
            term.trim() || userFilter || dateFrom || dateTo
              ? 'No Daily Reports match.'
              : 'No Daily Reports yet.'
          }
          onRowClick={(r) => setModal({ kind: 'view', id: r.id })}
          // The fit table's ▸ is the row's one expand control: it reveals the
          // report's task lines (fetched on open). A collapsed row fetches nothing.
          renderExpanded={(r) => (expandedIds.has(r.id) ? <ReportLinesExpand id={r.id} /> : null)}
          onToggleExpanded={(r) => toggleExpand(r.id)}
          rowMenu={(r) => [
            {
              key: 'edit',
              label: 'Edit',
              icon: 'pencil',
              hidden: !r.canEdit,
              onSelect: () => setModal({ kind: 'edit', id: r.id }),
            },
          ]}
        />
      </Panel>

      {modal.kind === 'new' ? <NewReportModal onClose={() => setModal({ kind: 'none' })} /> : null}
      {modal.kind === 'edit' ? (
        <EditReportModal id={modal.id} onClose={() => setModal({ kind: 'none' })} />
      ) : null}
      {modal.kind === 'view' ? (
        <ViewReportModal id={modal.id} onClose={() => setModal({ kind: 'none' })} />
      ) : null}
    </div>
  );
}
