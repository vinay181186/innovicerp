// All Design Issues (Design slice D) — cross-project view.
// Mirrors legacy renderDesignIssuesPage (HTML L7890).

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useDesignIssuesAll } from '../api';

type FilterKey = 'all' | 'open' | 'resolved' | 'critical';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All',
  open: 'Open',
  resolved: 'Resolved',
  critical: 'Critical',
};

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

  const { data, isLoading, isFetching, isError, error } = useDesignIssuesAll({
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
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="All Design Issues"
        icon="⚠"
        count={data?.total}
        noun="issue"
        filterNote={filter === 'all' ? undefined : FILTER_LABEL[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search issue, part, assigned to, project…"
        updating={isFetching && !isLoading}
        tools={
          <Select
            aria-label="Issue filter"
            fieldWidth="md"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            options={(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => ({
              value: k,
              label: FILTER_LABEL[k],
            }))}
          />
        }
      >
        {/* The counts double as the filter — ONE strip, not four cards. */}
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'Total',
              count: summary.total,
              color: 'var(--blue)',
              active: filter === 'all',
              onClick: () => setFilter('all'),
            },
            {
              key: 'open',
              label: 'Open',
              count: summary.open,
              color: 'var(--red2)',
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
      </ListHeader>

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
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Project</th>
                  <th>Severity</th>
                  <th>Issue Status</th>
                  <th>Assigned To</th>
                  <th>Raised Date</th>
                  <th>Age</th>
                  <th>Action</th>
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
                  const stale = i.ageDays > 5 && i.status !== 'Resolved' && i.status !== 'Closed';
                  return (
                    <tr key={i.id}>
                      <td className="fw-700" style={{ textAlign: 'left' }}>
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
                      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtDate(i.raisedDate)}
                      </td>
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
      {data ? <ListFooter total={data.total} noun="issue" limit={200} /> : null}
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
        fontSize: 11,
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
