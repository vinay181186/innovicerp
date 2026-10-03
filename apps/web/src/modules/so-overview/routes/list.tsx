// SO Overview list (PL-2 + PL-2b parity port, ADR-199 shared FIT table). One
// row per open SO: SO No. (pinned) · Customer · SO Type · Progress Status ·
// Progress bar · Order / Completed / Pending qty · Due Date · Alerts, with
// Client PO No. / Equipment / Lines / SO Date folded into the ▸ detail row.
// The columns + their helpers live in ../components/so-overview-columns.
//
// Clicking an SO row opens that SO's SO Status page (/sales-orders/$id/status,
// owner decision 2026-09-26); the SO No. link inside the first cell opens the SO
// itself (/sales-orders/$id). Rows tint by the derived progress status.
//
// ADR-201 (2026-10-02): 25 rows a page with Prev / Next. The search, the SO
// status, the overall (progress) status and Sort & Filter all run on the
// server over every SO; the overall-status counts in the dropdown come from
// the server too, so they never count just the page on screen.

import type { SoOverallStatus, SoOverviewResponse, SoOverviewRow } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchInput } from '@/ui/forms';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useSoOverview } from '../api';
import {
  SO_OVERVIEW_DEFAULT_HIDDEN,
  soOverviewColumns,
  soRowTint,
} from '../components/so-overview-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['open', 'closed', 'dispatched', 'cancelled', 'all']).optional(),
  overall: z
    .enum(['not_started', 'in_progress', 'on_track', 'delayed', 'completed', 'blocked'])
    .optional(),
  page: pageSearchParam,
});

export const soOverviewListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-overview',
  validateSearch: searchSchema,
  component: SoOverviewPage,
});

/** Per-row status filter (different from header.status — this filters the
 *  *derived* overallStatus). A dropdown in the filter bar with the counts in
 *  its option labels (was a pill row, PL-2b §1.3; owner decision 2026-09-26). */
type OverallStatusFilter = SoOverallStatus | 'all';
const OVERALL_STATUS_LABELS: Array<{ value: OverallStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'on_track', label: 'On Track' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
];

function SoOverviewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const routeNavigate = soOverviewListRoute.useNavigate();
  const { search, status, overall, page } = soOverviewListRoute.useSearch();
  const overallFilter: OverallStatusFilter = overall ?? 'all';
  // Bumped by Clear so a still-pending debounced keystroke cannot re-apply
  // the search it just cleared (SearchInput RESET SEMANTICS).
  const [clearKey, setClearKey] = useState(0);

  // The box keeps what the user typed (a trailing space included); only the
  // normalised term goes to the URL. Feeding the trimmed URL term back as the
  // box value made SearchInput overwrite the draft and eat a typed space.
  const urlRef = useRef({ search, status, overall });
  urlRef.current = { search, status, overall };
  const [searchInput, setSearchInput] = useState(search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link).
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search ?? '') ? prev : (search ?? ''),
    );
  }, [search]);
  useEffect(() => {
    // Runs only when the box changes (not when the URL does), so a Back to
    // another term is adopted above instead of being written over here.
    const next = normalizeSearchTerm(searchInput) || undefined;
    const cur = urlRef.current;
    if (next === cur.search) return;
    void navigate({
      to: '/so-overview',
      search: {
        ...(cur.status ? { status: cur.status } : {}),
        ...(cur.overall ? { overall: cur.overall } : {}),
        ...(next ? { search: next } : {}),
        page: 1,
      },
      replace: true,
    });
  }, [searchInput, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void routeNavigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [routeNavigate],
  );
  // Sort & Filter on the server (the list is paged); any change → page 1.
  const sf = useServerSortFilter(TABLE_KEYS.soOverview, () => gotoPage(1));
  const query = useMemo(
    () => ({
      search,
      status,
      overall,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [search, status, overall, sf.param, page],
  );
  const { data, isLoading, isFetching, isError, error } = useSoOverview(query);
  useClampPage(page, data?.total, gotoPage);

  const openSoStatus = (row: SoOverviewRow): void => {
    void navigate({ to: '/sales-orders/$id/status', params: { id: row.id } });
  };

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const columns = useMemo(() => soOverviewColumns(), []);
  const setOverall = (next: OverallStatusFilter): void => {
    void routeNavigate({
      search: (prev) => ({
        ...prev,
        overall: next === 'all' ? undefined : next,
        page: 1,
      }),
      replace: true,
    });
  };

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header stays on screen down
    // to the last row.
    <div className="page-fill">
      {/* The ONE list header (ui/layout ListHeader). The debounced SearchInput
          rides in `searchSlot` so the URL write keeps its 300ms delay; the
          SO status and overall-status (with counts) dropdowns sit beside it
          in the filter bar. */}
      <ListHeader
        title="SO Overview"
        icon="📊"
        count={data ? total : undefined}
        updating={isFetching && !isLoading}
        noun="SO"
        filterNote={
          overallFilter !== 'all'
            ? OVERALL_STATUS_LABELS.find((o) => o.value === overallFilter)?.label
            : undefined
        }
        searchSlot={
          // Our server (so-overview/service.ts) ILIKEs code / internal SO No. /
          // customerName / clientPoNo only — the placeholder states what actually works.
          <SearchInput
            debounceMs={300}
            resetKey={clearKey}
            placeholder="Search SO No., Internal SO No., customer, Client PO No.…"
            value={searchInput}
            onChange={setSearchInput}
          />
        }
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="SO status"
              title="SO status"
              value={status ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/so-overview',
                  search: {
                    ...(search ? { search } : {}),
                    ...(overall ? { overall } : {}),
                    page: 1,
                    status:
                      (e.target.value as
                        | 'open'
                        | 'closed'
                        | 'dispatched'
                        | 'cancelled'
                        | 'all'
                        | '') || undefined,
                  },
                })
              }
            >
              <option value="">Open (default)</option>
              <option value="closed">Closed</option>
              <option value="dispatched">Dispatched</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <OverallStatusSelect
              summary={data?.summary}
              value={overallFilter}
              onChange={setOverall}
            />
          </>
        }
        onClearFilters={() => {
          setClearKey((k) => k + 1);
          sf.clearFilters();
          void navigate({ to: '/so-overview', search: { page: 1 }, replace: true });
        }}
        filtersActive={
          !!(search || status || searchInput) || overallFilter !== 'all' || sf.filtering
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load SO overview. Try again.'
          }
        />
      ) : (
        // THE shared FIT table (ADR-199). SO No. is pinned; Client PO No. /
        // Equipment / Lines / SO Date live in the ▸ detail row by default. Rows
        // tint by the derived progress status, the row click opens the SO Status
        // page, and the SO No. link inside the first cell opens the SO itself.
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.soOverview}
            columns={columns}
            rows={rows}
            loading={isLoading}
            defaultHidden={SO_OVERVIEW_DEFAULT_HIDDEN}
            sortFilterServer={sf}
            emptyText={
              search || status || overallFilter !== 'all' || sf.filtering
                ? 'No SOs match.'
                : 'No SOs yet.'
            }
            onRowClick={openSoStatus}
            rowClassName={(row) => soRowTint(row.overallStatus)}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={total}
          noun="SO"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={gotoPage}
        />
      ) : null}
    </div>
  );
}

function OverallStatusSelect({
  summary,
  value,
  onChange,
}: {
  /** Server counts over every SO matching the other filters (not the page). */
  summary: SoOverviewResponse['summary'] | undefined;
  value: OverallStatusFilter;
  onChange: (next: OverallStatusFilter) => void;
}): React.JSX.Element {
  const counts: Record<OverallStatusFilter, number> = {
    all: summary?.soCount ?? 0,
    not_started: summary?.notStartedCount ?? 0,
    in_progress: summary?.inProgressCount ?? 0,
    on_track: summary?.onTrackCount ?? 0,
    delayed: summary?.delayedCount ?? 0,
    completed: summary?.completedCount ?? 0,
    blocked: summary?.blockedCount ?? 0,
  };
  return (
    <select
      className="innovic-select"
      aria-label="Overall status"
      title="Overall status"
      value={value}
      onChange={(e) => onChange(e.target.value as OverallStatusFilter)}
    >
      {OVERALL_STATUS_LABELS.map((opt) => {
        const count = counts[opt.value] ?? 0;
        // Skip non-"all" options when count is zero AND not selected.
        if (opt.value !== 'all' && count === 0 && value !== opt.value) return null;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label} ({count})
          </option>
        );
      })}
    </select>
  );
}
