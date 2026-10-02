// Design Projects — list view (ADR-199 table standard 2026-10-01). THE Innovic
// fit table: one ruled sheet, one row per project of the standard columns, the
// row's ▸ opens Description / Start Date / Engineers, the row click opens the
// project. The card grid and its hand-rolled progress markup are retired (moved
// to components/design-project-columns.tsx); the Add modal moved to
// components/add-project-modal.tsx. DATA and RULES are unchanged: same query,
// same dsnproj_create access matrix, same Project filter + its counts, same
// StatStrip, same search.
//
// ADR-201: 25 projects a page (page in the URL). Search, the Project filter and
// the column ▾ Sort & Filter run on the server over every project; any change of
// them goes back to page 1. The filter counts and the Tasks / Open Issues strip
// come from the server over the same search + Sort & Filter (the strip also
// follows the Project filter — it sums the listed projects).

import { type DesignProjectListItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, StatStrip } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
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

export const designProjectsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-projects',
  validateSearch: z.object({ page: pageSearchParam }),
  component: DesignProjectsListPage,
});

function DesignProjectsListPage(): React.JSX.Element {
  const navigate = designProjectsListRoute.useNavigate();
  // Tier-driven per Access Control (dsnproj_create, Design dept).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showAdd, setShowAdd] = useState(false);
  const { page } = designProjectsListRoute.useSearch();
  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  // Debounced search → server; a new term goes back to page 1.
  useEffect(() => {
    const trimmed = normalizeSearchTerm(search);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.designProjects, () => gotoPage(1));

  const { data, isLoading, isFetching, isError, error } = useDesignProjectsList({
    search: term,
    filter,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);
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
    // `page-fill` (ADR-201): the TABLE is this page's only scrollbar, so the
    // column header cannot ride off the top of the screen at the last row.
    <div className="page-fill">
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
            onChange={(e) => {
              setFilter(e.target.value as FilterKey);
              gotoPage(1);
            }}
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
          sf.clearFilters();
          gotoPage(1);
        }}
        filtersActive={search.trim() !== '' || filter !== 'all' || sf.filtering}
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
        <Panel fill bodyPadding="none">
          <DataTable<DesignProjectListItem>
            tableKey={TABLE_KEYS.designProjects}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={
              search.trim() || filter !== 'all' || sf.filtering
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

      <ListFooter
        total={total}
        noun="project"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {showAdd ? <AddProjectModal onClose={() => setShowAdd(false)} /> : null}
    </div>
  );
}
