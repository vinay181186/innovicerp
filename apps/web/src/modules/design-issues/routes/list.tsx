// All Design Issues (Design slice D) — cross-project view.
// Mirrors legacy renderDesignIssuesPage (HTML L7890).
//
// ADR-199 table standard (2026-10-01): the issue list is the ONE fit table
// (<DataTable tableKey={TABLE_KEYS.designIssues}>) — the issue (first column) is
// pinned, numbers (Days Open) are right-aligned, the row washes by status and
// the row's ⋯ carries Assign Task. Row click opens the design project behind
// the issue (there is no standalone issue detail page).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { DesignIssueListItem } from '@innovic/shared';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useSession } from '@/lib/session';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDesignIssuesAll } from '../api';

type FilterKey = 'all' | 'open' | 'resolved' | 'critical';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All',
  open: 'Open',
  resolved: 'Resolved',
  critical: 'Critical',
};

const LIST_LIMIT = 200;

export const designIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-issues',
  component: DesignIssuesAllPage,
});

/** Whole-row wash by the issue's status (ADR-199 ROW_TINT): Resolved / Closed →
 *  done (green); an issue open longer than 5 days → late (red); otherwise no
 *  wash. The 5-day line matches the old "stale" red on Days Open. */
function issueRowTint(i: DesignIssueListItem): string | undefined {
  if (i.status === 'Resolved' || i.status === 'Closed') return ROW_TINT.done;
  if (i.ageDays > 5) return ROW_TINT.late;
  return undefined;
}

function DesignIssuesAllPage(): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnissue_create');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const navigate = useNavigate();
  const { data: me } = useSession();
  // The issue whose ⋯ → Assign Task is open (one modal for the whole list).
  const [assignTarget, setAssignTarget] = useState<{
    id: string;
    title: string;
    designProjectId: string;
  } | null>(null);

  const { data, isLoading, isFetching, isError, error } = useDesignIssuesAll({
    search: search.trim() || undefined,
    filter,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const summary = data?.summary ?? { total: 0, open: 0, resolved: 0, critical: 0 };
  const filterCount: Record<FilterKey, number> = {
    all: summary.total,
    open: summary.open,
    resolved: summary.resolved,
    critical: summary.critical,
  };

  // "Hide page" (Access Control → Config): a user whose VIEW was removed for
  // the Design Issues page sees the no-access panel, not the page.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  const rows = data?.items ?? [];
  const columns: DataTableColumn<DesignIssueListItem>[] = [
    {
      id: 'issue',
      header: 'Issue',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      // The row's ▸ opens the engine detail; the title link opens the design
      // project. stopPropagation on the link, not the cell.
      render: (i) => (
        <Link
          to="/design-projects/$id"
          params={{ id: i.designProjectId }}
          style={{ color: 'inherit', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {i.title}
        </Link>
      ),
      title: (i) => i.title,
    },
    {
      id: 'project',
      header: 'Project',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (i) => <span style={{ color: 'var(--purple)' }}>{i.projectName ?? '—'}</span>,
      title: (i) => i.projectName ?? '',
    },
    {
      id: 'severity',
      header: 'Severity',
      kind: 'badge',
      nowrap: true,
      render: (i) => <Badge value={i.severity} />,
    },
    {
      id: 'status',
      header: 'Issue Status',
      kind: 'badge',
      nowrap: true,
      render: (i) => <Badge value={i.status} />,
    },
    {
      id: 'assigned_to',
      header: 'Assigned To',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (i) => i.assignedToText ?? '—',
      title: (i) => i.assignedToText ?? '',
    },
    {
      id: 'raised_date',
      header: 'Raised Date',
      kind: 'date',
      nowrap: true,
      render: (i) => fmtDate(i.raisedDate),
    },
    {
      id: 'days_open',
      header: 'Days Open',
      kind: 'num',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      filterValue: (i) => i.ageDays,
      render: (i) => {
        const stale = i.ageDays > 5 && i.status !== 'Resolved' && i.status !== 'Closed';
        return <span style={{ color: stale ? 'var(--red)' : 'var(--text3)' }}>{i.ageDays}d</span>;
      },
    },
  ];

  return (
    // `page-fill` (ADR-201): the TABLE is this page's only scrollbar, so the
    // column header cannot ride off the top of the screen at the last row.
    <div className="page-fill">
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
        filters={
          <Select
            aria-label="Issue filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            // Counts in the labels — they were the clickable Total / Open /
            // Resolved / Critical strip (owner's filter-bar decision 2026-09-26).
            options={(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => ({
              value: k,
              label: `${FILTER_LABEL[k]} (${filterCount[k]})`,
            }))}
          />
        }
        onClearFilters={() => {
          setSearch('');
          setFilter('all');
        }}
        filtersActive={search.trim() !== '' || filter !== 'all'}
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load design issues. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<DesignIssueListItem>
            tableKey={TABLE_KEYS.designIssues}
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={
              search.trim() || filter !== 'all'
                ? 'No Design Issues match.'
                : 'No Design Issues yet.'
            }
            rowClassName={(i) => issueRowTint(i)}
            onRowClick={(i) =>
              void navigate({ to: '/design-projects/$id', params: { id: i.designProjectId } })
            }
            rowMenu={(i) => [
              {
                // Same rule as the old button: none on a resolved / closed issue;
                // a viewer is refused by the server.
                key: 'assign',
                label: 'Assign Task',
                icon: 'user-round',
                group: 'assign',
                hidden:
                  i.status === 'Closed' || i.status === 'Resolved' || !me || me.role === 'viewer',
                onSelect: () =>
                  setAssignTarget({
                    id: i.id,
                    title: i.title,
                    designProjectId: i.designProjectId,
                  }),
              },
            ]}
          />
        </Panel>
      )}

      {data ? <ListFooter total={data.total} noun="issue" limit={LIST_LIMIT} /> : null}
      {assignTarget ? (
        <AssignTaskModal
          linkedRef={{
            type: 'design_issue',
            id: assignTarget.id,
            display: `Design issue: ${assignTarget.title}`,
            navPage: `/design-projects/${assignTarget.designProjectId}`,
          }}
          suggestedTitle={`Resolve design issue: ${assignTarget.title}`}
          onClose={() => setAssignTarget(null)}
        />
      ) : null}
    </div>
  );
}

/** Severity / status badge — house classes: Critical red, Major amber, Minor
 *  grey; Open blue, In Progress amber, Resolved / Closed green. */
function Badge({ value }: { value: string }): React.JSX.Element {
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
