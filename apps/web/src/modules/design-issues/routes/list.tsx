// All Design Issues (Design slice D) — cross-project view.
// Mirrors legacy renderDesignIssuesPage (HTML L7890).

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDesignIssuesAll } from '../api';

type FilterKey = 'all' | 'open' | 'resolved' | 'critical';

export const designIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-issues',
  component: DesignIssuesAllPage,
});

function DesignIssuesAllPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  const { data, isLoading, isError, error } = useDesignIssuesAll({
    search: search.trim() || undefined,
    filter,
    limit: 200,
    offset: 0,
  });
  const summary = data?.summary ?? { total: 0, open: 0, resolved: 0, critical: 0 };

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Tile
          label="Total"
          value={summary.total}
          color="var(--blue)"
          onClick={() => setFilter('all')}
        />
        <Tile
          label="Open"
          value={summary.open}
          color="var(--red)"
          onClick={() => setFilter('open')}
        />
        <Tile
          label="Resolved"
          value={summary.resolved}
          color="var(--green)"
          onClick={() => setFilter('resolved')}
        />
        <Tile
          label="Critical"
          value={summary.critical}
          color="var(--red)"
          onClick={() => setFilter('critical')}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          ⚠ All Design Issues
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            style={{ fontSize: 12 }}
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Project</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Assigned To</th>
                  <th>Date</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No issues
                    </td>
                  </tr>
                ) : null}
                {data.items.map((i) => {
                  const stale =
                    i.ageDays > 5 && i.status !== 'Resolved' && i.status !== 'Closed';
                  return (
                    <tr key={i.id}>
                      <td className="fw-700">
                        <Link
                          to="/design-projects/$id"
                          params={{ id: i.designProjectId }}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {i.title}
                        </Link>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--purple)' }}>
                        {i.projectName ?? ''}
                      </td>
                      <td>
                        <Badge value={i.severity} />
                      </td>
                      <td>
                        <Badge value={i.status} kind="status" />
                      </td>
                      <td style={{ fontSize: 11, fontWeight: 600 }}>{i.assignedToText ?? ''}</td>
                      <td style={{ fontSize: 11 }}>{i.raisedDate}</td>
                      <td
                        className="mono fw-700"
                        style={{ color: stale ? 'var(--red)' : 'var(--text3)' }}
                      >
                        {i.ageDays}d
                      </td>
                      <td>
                        {i.status !== 'Closed' && i.status !== 'Resolved' ? (
                          <AssignTaskButton
                            linkedRef={{
                              type: 'design_issue',
                              id: i.id,
                              display: `Design issue: ${i.title}`,
                              navPage: `/design-projects/${i.designProjectId}`,
                            }}
                            suggestedTitle={`Resolve design issue: ${i.title}`}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <div
      className="panel"
      onClick={onClick}
      style={{ textAlign: 'center', padding: 12, cursor: 'pointer' }}
    >
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Badge({ value, kind }: { value: string; kind?: 'status' }): React.JSX.Element {
  const v = value.toLowerCase().replace(/[\s/]/g, '');
  // Colour map mirrors legacy _dpBadge (HTML L7555-7562) exactly — note Major
  // is orange there, not amber.
  const colors: Record<string, string> = {
    critical: 'var(--red)',
    major: 'var(--orange)',
    minor: 'var(--green)',
    open: 'var(--red)',
    inprogress: 'var(--blue)',
    resolved: 'var(--green)',
    closed: 'var(--text3)',
  };
  const c = colors[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: kind === 'status' ? 4 : 12,
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}30`,
      }}
    >
      {value}
    </span>
  );
}
