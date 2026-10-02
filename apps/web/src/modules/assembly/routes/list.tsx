// Assembly Tracker list (PL-5 + PL-5b). All Equipment SOs with assembled /
// dispatched counts + status badge. Click-through to the per-SO tracker.
//
// ADR-199: on the shared FIT table (<DataTable tableKey={TABLE_KEYS.assemblies}>)
// so the Columns / density toolbar, the saved layout, the pinned first column
// (SO No.) and the one ▸ expand control come for free. The ▸ reveals the BOM
// Name in place under the row; the row itself opens the per-SO tracker. Rows
// wash by assembly status (ROW_TINT) — waiting is pending work, done is green.
//
// PL-5b parity port (renderAssemblyTracker L28738–28787):
//   - the 5 status tile counts (Total / Waiting / Ready / In Assembly / Completed)
//     ride in the status dropdown's option labels (owner decision 2026-09-26:
//     no tiles/capsules beside a filter dropdown)
//   - Search input + status filter dropdown
//   - Due Date column
// Legacy renders ONE screen: an accordion of per-SO cards. The port splits it —
// this list is legacy's collapsed card header (L28782–28787); the expanded body
// (L28788–28884) is /assemblies/$soId. Both map to renderAssemblyTracker in
// docs/page-registry.yaml. See docs/PARITY/assytracker.md §0/§8 for that DELTA.
//
// ADR-201 (2026-10-02): 25 rows a page with Prev / Next. Search, the status
// dropdown and Sort & Filter (on SO No. / Customer / BOM No. / Due Date /
// Required) run on the SERVER over every Equipment SO; the dropdown's (n)
// counts come from the server too. Any change of them goes back to page 1.
// Search covers SO no., customer, BOM no. and BOM name (no longer the status
// text: the status dropdown is the status filter).
//
// Port additions with NO legacy counterpart (kept deliberately, not parity):
//   - red/bold Due when overdue (legacy L28785 prints the date unstyled)
//   - Dispatched column (legacy shows it only in the expanded body, L28795)

import { ASSEMBLY_LIST_STATUSES, type ListAssembliesQuery } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useAssembliesList } from '../api';
import { assemblyListColumns, ROW_TINT_BY_STATUS } from '../components/assembly-list-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(ASSEMBLY_LIST_STATUSES).optional(),
  page: pageSearchParam,
});

export const assemblyListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'assemblies',
  validateSearch: searchSchema,
  component: AssemblyListPage,
});

type FilterKey = 'all' | (typeof ASSEMBLY_LIST_STATUSES)[number];

// Status order + labels match legacy's tiles (L28747–28749).
const TILES: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Total' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'ready', label: 'Ready' },
  { key: 'assembling', label: 'In Assembly' },
  { key: 'done', label: 'Completed' },
];

function AssemblyListPage(): React.JSX.Element {
  const search = assemblyListRoute.useSearch();
  const navigate = useNavigate();
  const filter: FilterKey = search.status ?? 'all';
  // The soIds whose ▸ BOM Name row is open. The fit table's ▸ is the row's one
  // expand control: it toggles this set AND its own detail row (ADR-199).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Search lives in the URL; the box mirrors it and a 300ms debounce writes it
  // back (and goes to page 1).
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        to: '/assemblies',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ to: '/assemblies', search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.assemblies, () => gotoPage(1));
  const query: ListAssembliesQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(search.page),
    }),
    [search.search, search.status, search.page, sf.param],
  );
  const { data, isLoading, isFetching, isError, error } = useAssembliesList(query);
  useClampPage(search.page, data?.total, gotoPage);

  // IST today (the UTC date is yesterday before 05:30 IST).
  const today = todayIst();

  const toggleExpand = useCallback((soId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(soId)) next.delete(soId);
      else next.add(soId);
      return next;
    });
  }, []);

  const columns = useMemo(() => assemblyListColumns(today), [today]);
  const rows = data?.items ?? [];
  const counts = data?.counts;
  const filtersActive = searchInput !== '' || filter !== 'all' || sf.filtering;

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader): title · count, then the
          filter bar — search · status dropdown (the old tiles' counts in its
          option labels, counted on the server) · Clear. */}
      <ListHeader
        title="Assembly Tracker"
        icon="🔧"
        count={data ? data.total : undefined}
        noun="assembly order"
        filterNote={filter !== 'all' ? TILES.find((t) => t.key === filter)?.label : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search SO no., customer, BOM no. / name…"
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="Assembly status"
            title="Assembly status"
            value={filter}
            onChange={(e) => {
              const v = e.target.value as FilterKey;
              void navigate({
                to: '/assemblies',
                search: (prev) => ({ ...prev, status: v === 'all' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          >
            {TILES.map((t) => (
              <option key={t.key} value={t.key}>
                {`${t.key === 'all' ? 'All Status' : t.label}${counts ? ` (${counts[t.key]})` : ''}`}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/assemblies', search: { page: 1 }, replace: true });
        }}
        filtersActive={filtersActive}
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load assemblies. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.assemblies}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            rowKey={(row) => row.soId}
            empty={
              data && !filtersActive && data.total === 0
                ? 'No assembly orders yet.'
                : 'No assembly orders match.'
            }
            onRowClick={(row) =>
              void navigate({ to: '/assemblies/$soId', params: { soId: row.soId } })
            }
            rowClassName={(row) => ROW_TINT_BY_STATUS[row.status]}
            // The ▸ reveals the BOM Name in place. Returning null for a closed
            // row keeps the row collapsed; the caller owns the open set.
            renderExpanded={(row) =>
              expanded.has(row.soId) ? (
                <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
                  <span
                    className="fw-700"
                    style={{ fontSize: 'var(--fs-xs)', color: 'var(--cyan)' }}
                  >
                    BOM Name — {row.bomName ?? '—'}
                  </span>
                </div>
              ) : null
            }
            onToggleExpanded={(row) => toggleExpand(row.soId)}
          />
        </Panel>
      )}

      <ListFooter
        total={data?.total ?? 0}
        noun="assembly order"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />
    </div>
  );
}
