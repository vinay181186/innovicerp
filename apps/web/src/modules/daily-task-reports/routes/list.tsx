// Daily Task Reports — mirror of legacy renderDailyReports (HTML L14141).
// User-submitted "what I did today" reports. Admin sees all + a user filter;
// non-admins see their own (and may file/edit their own).

import { SHIFT_LABELS } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
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

  const { data, isLoading, isError, error } = useDailyReportList({
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
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📋 Daily Task Reports
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
          + New Report
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {data.isAdmin ? (
          <select className="innovic-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ fontSize: 12 }}>
            <option value="">All Users</option>
            {data.userOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : null}
        <input type="date" className="innovic-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ fontSize: 12 }} title="From" />
        <input type="date" className="innovic-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ fontSize: 12 }} title="To" />
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>User</th>
                <th>Shift</th>
                <th className="td-ctr">Tasks</th>
                <th className="td-ctr">Hours</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No reports found
                  </td>
                </tr>
              ) : (
                data.reports.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700 }}>{r.reportDate}</td>
                    <td style={{ fontWeight: 600 }}>{r.userName ?? '—'}</td>
                    <td>{SHIFT_LABELS[r.shift]}</td>
                    <td className="td-ctr mono fw-700">{r.taskCount}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.totalHours.toFixed(1)}h
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setModal({ kind: 'view', id: r.id })}>
                          👁 View
                        </button>
                        {r.canEdit ? (
                          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setModal({ kind: 'edit', id: r.id })}>
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
      {modal.kind === 'edit' ? <EditReportModal id={modal.id} onClose={() => setModal({ kind: 'none' })} /> : null}
      {modal.kind === 'view' ? <ViewReportModal id={modal.id} onClose={() => setModal({ kind: 'none' })} /> : null}
    </div>
  );
}
