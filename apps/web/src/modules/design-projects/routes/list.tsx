// Design Projects — list view (ADR-199 table standard 2026-10-01). THE Innovic
// fit table: one ruled sheet, one row per project of the standard columns, the
// row's ▸ opens Description / Start Date / Engineers, the row click opens the
// project. The card grid and its hand-rolled progress markup are retired (moved
// to components/design-project-columns.tsx); the Add modal moved to
// components/add-project-modal.tsx. DATA and RULES are unchanged: same query,
// same dsnproj_create access matrix, same Project filter + its counts, same
// StatStrip, same search.

import { type DesignProjectListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import {
  DesignProjectExpand,
  designProjectColumns,
  designProjectRowTint,
} from '../components/design-project-columns';
import { AddProjectModal } from '../components/add-project-modal';
import { useDesignProjectsList } from '../api';

type FilterKey = 'all' | 'active' | 'released' | 'hold';

const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All',
  active: 'Active',
  released: 'Released',
  hold: 'On Hold',
};

// The design-projects list loads all matching projects into one scrolling list
// (one fetch, offset 0); the API caps `limit` at 100.
const LIST_LIMIT = 100;

export const designProjectsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects',
  component: DesignProjectsListPage,
});

function DesignProjectsListPage(): React.JSX.Element {
  const navigate = designProjectsListRoute.useNavigate();
  // Tier-driven per Access Control (dsnproj_create, Design dept).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isFetching, isError, error } = useDesignProjectsList({
    search: search.trim() || undefined,
    filter,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const summary = data?.summary ?? {
    total: 0,
    active: 0,
    released: 0,
    onHold: 0,
    totalTasks: 0,
    doneTasks: 0,
    openIssues: 0,
  };

  const filterCount: Record<FilterKey, number> = {
    all: summary.total,
    active: summary.active,
    released: summary.released,
    hold: summary.onHold,
  };

  // The row's ▸ opens the Description / Start Date / Engineers detail in place.
  // A Set — many rows can be open at once.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const today = todayIst();
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const columns = designProjectColumns({ today });

  // "Hide page" (Access Control → Config): a user whose VIEW was removed for
  // this page sees the no-access panel, not the list. `eff` undefined only while
  // access loads — don't block then, or every legitimate user flashes it.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      <ListHeader
        title="Design Projects"
        icon="📋"
        count={total}
        noun="project"
        filterNote={filter === 'all' ? undefined : FILTER_LABEL[filter]}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search project no., name, SO no., customer…"
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label="Project filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            // Counts in the labels — they were the clickable Total / Active /
            // Released / On Hold tiles (owner's filter-bar decision 2026-09-26).
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
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              + New Project
            </button>
          ) : null
        }
      >
        {/* Read-only totals the Project filter dropdown does not carry. The
            Total / Active / Released / On Hold counts moved into its labels. */}
        <StatStrip
          items={[
            {
              key: 'tasks',
              label: 'Tasks Completed',
              count: `${summary.doneTasks}/${summary.totalTasks}`,
              color: 'var(--purple)',
            },
            {
              key: 'issues',
              label: 'Open Issues',
              count: summary.openIssues,
              color: summary.openIssues > 0 ? 'var(--red2)' : 'var(--green2)',
            },
          ]}
        />
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load design projects. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable<DesignProjectListItem>
            tableKey={TABLE_KEYS.designProjects}
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={
              search.trim() || filter !== 'all'
                ? 'No Design Projects match.'
                : 'No Design Projects yet.'
            }
            rowClassName={(p) => designProjectRowTint(p, today)}
            onRowClick={(p) => void navigate({ to: '/design-projects/$id', params: { id: p.id } })}
            renderExpanded={(p) =>
              expandedIds.has(p.id) ? <DesignProjectExpand project={p} /> : null
            }
            onToggleExpanded={(p) => toggleExpand(p.id)}
            renderLink={(props) => <Link {...props} />}
          />
        </Panel>
      )}

      <ListFooter total={total} shown={rows.length} noun="project" limit={LIST_LIMIT} />

      {showAdd ? <AddProjectModal onClose={() => setShowAdd(false)} /> : null}
    </div>
  );
}
