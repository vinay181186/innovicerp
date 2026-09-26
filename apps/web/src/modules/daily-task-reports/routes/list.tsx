// Daily Task Reports — mirror of legacy renderDailyReports (HTML L14141).
// User-submitted "what I did today" reports. Admin sees all + a user filter;
// non-admins see their own (and may file/edit their own).

import { SHIFT_LABELS } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { useDailyReportList } from '../api';
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
        tools={
          <>
            {data.isAdmin ? (
              <select
                className="innovic-select"
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                style={{ width: 'auto' }}
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

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Report Date</th>
                <th>User</th>
                <th>Shift</th>
                <th className="th-num">Tasks</th>
                <th className="th-num">Hours</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    {term.trim() || userFilter || dateFrom || dateTo
                      ? 'No Daily Reports match.'
                      : 'No Daily Reports yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setModal({ kind: 'view', id: r.id })}
                  >
                    <td style={{ fontWeight: 700 }}>{fmtDate(r.reportDate)}</td>
                    <td style={{ fontWeight: 600 }}>{r.userName ?? '—'}</td>
                    <td>{SHIFT_LABELS[r.shift]}</td>
                    <td className="td-num mono fw-700">{r.taskCount}</td>
                    <td className="td-num mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.totalHours.toFixed(1)}h
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3 }} onClick={(e) => e.stopPropagation()}>
                        {r.canEdit ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => setModal({ kind: 'edit', id: r.id })}
                          >
                            ✏ Edit
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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
