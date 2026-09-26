// All Design Issues (Design slice D) — cross-project view.
// Mirrors legacy renderDesignIssuesPage (HTML L7890).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
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
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnissue_create');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useDesignIssuesAll({
    search: search.trim() || undefined,
    filter,
    limit: 200,
    offset: 0,
  });
  const summary = data?.summary ?? { total: 0, open: 0, resolved: 0, critical: 0 };

  // "Hide page" (Access Control → Config): a user whose VIEW was removed for
  // the Design Issues page sees the no-access panel, not the page.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Design Issues. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {/* One strip; the tiles ARE the filter (no status dropdown). */}
      <div style={{ marginBottom: 16 }}>
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'Total',
              count: summary.total,
              active: filter === 'all',
              onClick: () => setFilter('all'),
            },
            {
              key: 'open',
              label: 'Open',
              count: summary.open,
              color: 'var(--blue)',
              active: filter === 'open',
              onClick: () => setFilter('open'),
            },
            {
              key: 'resolved',
              label: 'Resolved',
              count: summary.resolved,
              color: 'var(--green2)',
              active: filter === 'resolved',
              onClick: () => setFilter('resolved'),
            },
            {
              key: 'critical',
              label: 'Critical',
              count: summary.critical,
              color: 'var(--red2)',
              active: filter === 'critical',
              onClick: () => setFilter('critical'),
            },
          ]}
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
          All Design Issues
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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load design issues. Try again.'}
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
                  <th>Issue Status</th>
                  <th>Assigned To</th>
                  <th>Raised Date</th>
                  <th>Age</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {search.trim() || filter !== 'all'
                        ? 'No Design Issues match.'
                        : 'No Design Issues yet.'}
                    </td>
                  </tr>
                ) : null}
                {data.items.map((i) => {
                  const stale =
                    i.ageDays > 5 && i.status !== 'Resolved' && i.status !== 'Closed';
                  return (
                    <tr
                      key={i.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        void navigate({
                          to: '/design-projects/$id',
                          params: { id: i.designProjectId },
                        })
                      }
                    >
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
                      <td style={{ fontSize: 11 }}>{fmtDate(i.raisedDate)}</td>
                      <td
                        className="mono fw-700"
                        style={{ color: stale ? 'var(--red)' : 'var(--text3)' }}
                      >
                        {i.ageDays}d
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
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

/** Severity / status badge — house classes: Critical red, Major amber, Minor
 *  grey; Open blue, In Progress amber, Resolved / Closed green. */
function Badge({ value }: { value: string; kind?: 'status' }): React.JSX.Element {
  const v = value.toLowerCase().replace(/[\s/]/g, '');
  const cls: Record<string, string> = {
    critical: 'b-red',
    major: 'b-amber',
    minor: 'b-grey',
    open: 'b-blue',
    inprogress: 'b-amber',
    resolved: 'b-green',
    closed: 'b-green',
  };
  return <span className={`badge ${cls[v] ?? 'b-grey'}`}>{value}</span>;
}
