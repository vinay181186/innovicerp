import { activityActionLabel as actionLabel } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useActivityLog } from '../api';
import {
  ACTIVITY_LOG_HIDDEN_COLUMNS,
  ActivityLogExpand,
  activityLogColumns,
} from '../components/activity-log-columns';

const searchSchema = z.object({
  search: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: pageSearchParam,
});

export const activityLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'activity-log',
  validateSearch: searchSchema,
  component: ActivityLogListPage,
});

// Action words and badge colours come from ONE place (ADR-197): the label
// from @innovic/shared `activityActionLabel` (standard, legacy and ad-hoc
// names alike — legacy rows keep their old wording), the colour from
// lib/activity-entity.ts `activityActionBadge` (legacy hex map → tokens,
// ISSUE-067; unmapped names are grey). The stored codes stay the filter values.

function ActivityLogListPage() {
  const search = activityLogListRoute.useSearch();
  const navigate = activityLogListRoute.useNavigate();

  // The search term lives in the URL (?search=, server-side); the box mirrors
  // it and a 300ms debounce writes it back with replace + page 1 — the SO
  // Master shape. (It used to wait for an Apply button.)
  const [pendingSearch, setPendingSearch] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setPendingSearch((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(pendingSearch);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [pendingSearch, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the log is paged 25 at a
  // time, so sorting / filtering only the loaded page would miss entries.
  // Every change goes back to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.activityLog, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const offset = pageOffset(search.page);
  const query = useMemo(
    () => ({
      ...(search.search ? { search: search.search } : {}),
      ...(search.action ? { action: search.action } : {}),
      ...(search.userId ? { userId: search.userId } : {}),
      ...(search.fromDate ? { fromDate: search.fromDate } : {}),
      ...(search.toDate ? { toDate: search.toDate } : {}),
      ...(sf.param ? { sf: sf.param } : {}),
      limit: LIST_PAGE_SIZE,
      offset,
    }),
    [search, offset, sf.param],
  );
  const { data, isLoading, isError, error, isFetching } = useActivityLog(query);

  // The Action ▾ ticks the actions this company's log holds (the same list
  // the Action dropdown offers), shown by their standard label.
  const actions = data?.actions;
  const columns = useMemo(() => activityLogColumns(actions ?? []), [actions]);

  // ▸ reveal — the full Detail / remarks for a row. The caller owns the open set;
  // the fit engine's ▸ is the one toggle (onToggleExpanded).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setFilter = (key: 'action' | 'userId' | 'fromDate' | 'toDate', value: string) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, page: 1 };
        if (value) {
          (next as Record<string, unknown>)[key] = value;
        } else {
          delete (next as Record<string, unknown>)[key];
        }
        return next;
      },
      replace: true,
    });
  };

  const onClear = () => {
    sf.clearFilters();
    setPendingSearch('');
    void navigate({ search: () => ({ page: 1 }), replace: true });
  };

  const goToPage = useCallback(
    (n: number) => void navigate({ search: (prev) => ({ ...prev, page: n }), replace: true }),
    [navigate],
  );
  useClampPage(search.page, data?.total, goToPage);

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header and the pager stay on
    // screen down to the last row.
    <div className="page-fill">
      <ListHeader
        title="Activity Log"
        icon="📜"
        count={data ? data.total : undefined}
        noun="entry"
        nounPlural="entries"
        search={pendingSearch}
        onSearch={setPendingSearch}
        searchPlaceholder="Search action, document type, detail, document no., user…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="Action"
              title="Action"
              value={search.action ?? ''}
              onChange={(e) => setFilter('action', e.target.value)}
            >
              <option value="">All Actions</option>
              {(data?.actions ?? []).map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              aria-label="User"
              title="User"
              value={search.userId ?? ''}
              onChange={(e) => setFilter('userId', e.target.value)}
            >
              <option value="">All Users</option>
              {(data?.users ?? [])
                .filter((u) => u.id !== null)
                .map((u) => (
                  <option key={u.id ?? u.name} value={u.id ?? ''}>
                    {u.name}
                  </option>
                ))}
            </select>
            <input
              type="date"
              className="innovic-input"
              title="Log date from"
              aria-label="Log date from"
              value={search.fromDate ?? ''}
              onChange={(e) => setFilter('fromDate', e.target.value)}
            />
            <input
              type="date"
              className="innovic-input"
              title="Log date to"
              aria-label="Log date to"
              value={search.toDate ?? ''}
              onChange={(e) => setFilter('toDate', e.target.value)}
            />
          </>
        }
        onClearFilters={onClear}
        filtersActive={
          sf.filtering ||
          !!search.action ||
          !!search.userId ||
          !!search.fromDate ||
          !!search.toDate ||
          pendingSearch.trim() !== ''
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load activity log. Try again.'
          }
        />
      ) : (
        // THE shared FIT table (ADR-199). First column (Log Date) is pinned; no
        // detail page for a log row, so a row is not clickable — the ▸ reveals
        // its full Detail / remarks.
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.activityLog}
            sortFilterServer={sf}
            columns={columns}
            defaultHidden={[...ACTIVITY_LOG_HIDDEN_COLUMNS]}
            rows={data?.entries ?? []}
            rowKey={(e) => e.id}
            loading={isLoading}
            emptyText={
              search.search ||
              search.action ||
              search.userId ||
              search.fromDate ||
              search.toDate ||
              sf.filtering
                ? 'No entries match.'
                : 'No activity yet.'
            }
            renderExpanded={(e) => (expanded.has(e.id) ? <ActivityLogExpand entry={e} /> : null)}
            onToggleExpanded={(e) => toggleExpand(e.id)}
          />
        </Panel>
      )}

      {/* Port-only: legacy renders every row with no pager. */}
      {data ? (
        <ListFooter
          total={data.total}
          noun="entry"
          nounPlural="entries"
          page={search.page}
          pageSize={LIST_PAGE_SIZE}
          onPage={goToPage}
        />
      ) : null}
    </div>
  );
}
