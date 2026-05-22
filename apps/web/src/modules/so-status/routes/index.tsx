// SO Status Review index (PL-1c). Mirrors legacy renderSOStatus L4255 entry
// behaviour — left list of SOs sorted descending by SO date, click navigates
// to /sales-orders/$id/status. Lives at /so-status so the sidebar "SO Status
// Review" entry (legacy sidebar L404) has a destination instead of being
// drill-through-only from SO Overview.
//
// Data: reuses GET /so-overview (no new endpoint). For the index we want
// every open SO; matches legacy's _soSel default (first SO).
//
// See docs/PARITY/planning-sidebar.md BLOCKER #2 and docs/PARITY/so-status.md
// for the gap analysis.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoOverview } from '../../so-overview/api';

export const soStatusIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-status',
  component: SoStatusIndexPage,
});

const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component',
  equipment: 'Equipment',
  with_material: 'With Material',
};

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  not_started: { cls: 'b-grey', label: 'Not Started' },
  in_progress: { cls: 'b-cyan', label: 'In Progress' },
  on_track: { cls: 'b-blue', label: 'On Track' },
  delayed: { cls: 'b-red', label: 'Delayed' },
  completed: { cls: 'b-green', label: 'Completed' },
  blocked: { cls: 'b-amber', label: 'Blocked' },
};

function SoStatusIndexPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useSoOverview({});
  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const sorted = [...data.rows].sort((a, b) => (b.soDate ?? '').localeCompare(a.soDate ?? ''));
    if (!q) return sorted;
    return sorted.filter((r) =>
      `${r.code} ${r.customerName ?? ''} ${r.clientPoNo ?? ''}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📊 SO Status Review</div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load SO list'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 14,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              className="innovic-input"
              placeholder="🔍 Search SO, customer, PO…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 280 }}
            />
            <span className="text3" style={{ fontSize: 12 }}>
              {filtered.length} of {data.rows.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="panel">
              <div className="panel-body">
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  {data.rows.length === 0
                    ? 'No SOs found. Create one on the Sales Orders page.'
                    : 'No SOs match your search.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>SO #</th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>SO Date</th>
                      <th>Due</th>
                      <th className="td-ctr">Lines</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const status = STATUS_BADGE[row.overallStatus] ?? {
                        cls: 'b-grey',
                        label: row.overallStatus,
                      };
                      const overdue =
                        row.earliestDueDate !== null &&
                        row.earliestDueDate < today &&
                        row.overallStatus !== 'completed';
                      return (
                        <tr key={row.id}>
                          <td>
                            <Link
                              to="/sales-orders/$id/status"
                              params={{ id: row.id }}
                              className="td-code"
                              style={{ color: 'var(--cyan)', fontWeight: 600 }}
                            >
                              {row.code}
                            </Link>
                          </td>
                          <td>
                            {row.customerName ?? '—'}
                            {row.clientPoNo ? (
                              <div className="text3" style={{ fontSize: 11 }}>
                                PO: {row.clientPoNo}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <span className="text3" style={{ fontSize: 12 }}>
                              {TYPE_LABEL[row.type] ?? row.type}
                            </span>
                          </td>
                          <td>{row.soDate}</td>
                          <td
                            style={{
                              color: overdue ? 'var(--red)' : undefined,
                              fontWeight: overdue ? 600 : undefined,
                            }}
                          >
                            {row.earliestDueDate ?? '—'}
                          </td>
                          <td className="td-ctr">{row.lineCount}</td>
                          <td>
                            <span className={`badge ${status.cls}`}>{status.label}</span>
                          </td>
                          <td>
                            <Link
                              to="/sales-orders/$id/status"
                              params={{ id: row.id }}
                              className="btn btn-sm btn-ghost"
                            >
                              Review →
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
