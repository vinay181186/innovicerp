// Production Orders master (ADR-170). THE Innovic fit table (ADR-199, table
// standard 2026-10-01): one ruled sheet on <DataTable tableKey=
// {TABLE_KEYS.productionOrders}>, every order one row of the eight primary
// columns, the four secondary facts (Plan No., SO / JWSO No., POL, JC No.)
// riding in the row's ▸ detail. The column defs and row tint live in
// components/po-list-columns.tsx so this file stays under the 400-line ceiling.
//
// What stays (DATA + RULES unchanged): the same query and cache, the same
// prodorder_create access matrix (view gate + entry gate on New), the
// All / Open / Closed / Short Closed status dropdown with its counts, and the
// `search` / `status` URL params. Search is server-side (`?search=` matches PO
// code, plan code, POL, item code / name, JC code and SO code — every text
// column this table shows; see the API contract). Like SO Master this list
// SCROLLS rather than pages: one fetch at the contract's cap (500); the count
// line flags a larger set. Columns sort in memory via useClientSort (the rows
// are already fully loaded), exactly as the retired react-table sort did.

import {
  type ListProductionOrdersQuery,
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  type ProductionOrderListItem,
  type ProductionOrderStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, useClientSort } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useProductionOrdersList } from '../api';
import { PO_LIST_DETAIL_IDS, poListColumns, poRowTint } from '../components/po-list-columns';

// listProductionOrdersQuerySchema caps `limit` at 500.
const LIST_LIMIT = 500;

// Tile counts ignore the search box (they count the whole book, like SO Master
// and the PR list). Module-level constants keep the query keys stable.
const COUNT_ALL: ListProductionOrdersQuery = { limit: 1, offset: 0 };
const COUNT_OPEN: ListProductionOrdersQuery = { status: 'open', limit: 1, offset: 0 };
const COUNT_CLOSED: ListProductionOrdersQuery = { status: 'closed', limit: 1, offset: 0 };
// ADR-182 — orders stopped at some stage. Its own tile so a stopped order is
// never mistaken for a finished one.
const COUNT_SHORT_CLOSED: ListProductionOrdersQuery = {
  status: 'short_closed',
  limit: 1,
  offset: 0,
};

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PRODUCTION_ORDER_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const productionOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders',
  validateSearch: listSearchSchema,
  component: ProductionOrdersListPage,
});

function ProductionOrdersListPage(): React.JSX.Element {
  const search = productionOrdersListRoute.useSearch();
  const navigate = productionOrdersListRoute.useNavigate();
  // Tier-driven, per department (Production). Entry raises a PO.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-PRO  00012 " and "IN-PRO 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListProductionOrdersQuery = useMemo(
    () => ({
      ...(search.search ? { search: search.search } : {}),
      ...(search.status ? { status: search.status } : {}),
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.status],
  );

  const { data, isLoading, isFetching, isError, error } = useProductionOrdersList(query);

  const allCount = useProductionOrdersList(COUNT_ALL).data?.total ?? 0;
  const openCount = useProductionOrdersList(COUNT_OPEN).data?.total ?? 0;
  const closedCount = useProductionOrdersList(COUNT_CLOSED).data?.total ?? 0;
  const shortClosedCount = useProductionOrdersList(COUNT_SHORT_CLOSED).data?.total ?? 0;

  const setStatusFilter = useCallback(
    (next: ProductionOrderStatus | undefined): void => {
      void navigate({ search: (prev) => ({ ...prev, status: next, page: 1 }), replace: true });
    },
    [navigate],
  );
  const clearFilters = (): void => {
    setSearchInput('');
    void navigate({
      search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
      replace: true,
    });
  };
  const filtersActive = searchInput.trim() !== '' || search.status != null;

  const columns = useMemo(() => poListColumns(), []);
  const items = useMemo(() => data?.items ?? [], [data?.items]);
  // Client-side sort over the fully-loaded list — the same behaviour the old
  // react-table getSortedRowModel gave, without a server round-trip.
  const { rows, sortBy, sortDir, onSort } = useClientSort<ProductionOrderListItem>(items);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. Sits
  // after every hook so the early return never trips rules-of-hooks.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Production Orders. Ask an admin.
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      {/* Frozen header band — title + count + New PO + the filter bar stay
          pinned; the table scrolls under them. */}
      <ListHeader
        title="Production Orders"
        icon="🏭"
        count={total}
        noun="order"
        filterNote={search.status ? PRODUCTION_ORDER_STATUS_LABEL[search.status] : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search Production Order No., plan, POL, item, JC, SO…"
        updating={isFetching && !isLoading}
        onClearFilters={clearFilters}
        filtersActive={filtersActive}
        filters={
          <Select
            aria-label="Production Order Status"
            title="Production Order Status"
            value={search.status ?? ''}
            options={[
              { value: '', label: `All (${allCount})` },
              { value: 'open', label: `Open (${openCount})` },
              { value: 'closed', label: `Closed (${closedCount})` },
              {
                value: 'short_closed',
                label: `${PRODUCTION_ORDER_STATUS_LABEL.short_closed} (${shortClosedCount})`,
              },
              // Partly Closed never had a tile; it stays reachable only through
              // a link that already carries it, so the box can still show it.
              ...(search.status === 'partially_closed'
                ? [
                    {
                      value: 'partially_closed',
                      label: PRODUCTION_ORDER_STATUS_LABEL.partially_closed,
                    },
                  ]
                : []),
            ]}
            onChange={(e) =>
              setStatusFilter(
                e.target.value === '' ? undefined : (e.target.value as ProductionOrderStatus),
              )
            }
          />
        }
        primary={
          perms.entry ? (
            <Link to="/production-orders/new" className="btn btn-primary">
              <Plus size={14} /> New Production Order
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load Production Orders. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<ProductionOrderListItem>
            tableKey={TABLE_KEYS.productionOrders}
            columns={columns}
            // Plan No. / SO / JWSO / POL / JC No. ride in the ▸ detail row.
            defaultHidden={PO_LIST_DETAIL_IDS}
            rows={rows}
            loading={isLoading}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={onSort}
            empty={
              search.search || search.status
                ? 'No Production Orders match.'
                : 'No Production Orders yet.'
            }
            rowClassName={(po) => poRowTint(po)}
            onRowClick={(po) =>
              void navigate({ to: '/production-orders/$id', params: { id: po.id } })
            }
            renderLink={(p) => <Link {...p} />}
          />
        </Panel>
      )}

      {isError ? null : (
        <ListFooter total={total} shown={rows.length} noun="production order" limit={LIST_LIMIT} />
      )}
    </div>
  );
}
