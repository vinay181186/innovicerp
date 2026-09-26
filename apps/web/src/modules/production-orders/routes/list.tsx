// Production Orders master (ADR-170). SO Master List is THE style reference:
// <ListHeader> band (title + count + search + New), ONE StatStrip row whose
// tiles filter (Open, All, Closed, Short Closed), a react-table grid with
// SortableHead, clickable rows, document codes in strong mono.
//
// Search is server-side (`?search=` matches PO code, plan code, POL, item code
// / name, JC code and SO code — every text column this table shows; see the
// API contract), so no client-side filter is layered on top. Like SO Master
// this list SCROLLS rather than pages: one fetch at the contract's cap (500);
// the count line flags a larger set.

import {
  type ListProductionOrdersQuery,
  PRODUCTION_ORDER_STATUSES,
  PRODUCTION_ORDER_STATUS_LABEL,
  type ProductionOrderListItem,
  type ProductionOrderStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { SortableHead } from '@/components/shared/sortable-head';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useProductionOrdersList } from '../api';
import { PoStatusBadge } from '../components/po-status-badge';

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
  const toggleStatus = (s: ProductionOrderStatus) => () =>
    setStatusFilter(search.status === s ? undefined : s);

  const columns = useMemo<ColumnDef<ProductionOrderListItem>[]>(
    () => [
      {
        header: 'Production Order No',
        accessorKey: 'code',
        meta: { tdClass: 'td-code' },
        cell: ({ row }) => (
          <Link
            to="/production-orders/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--text)', fontWeight: 700, textDecoration: 'none' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Production Order Date',
        accessorKey: 'createdAt',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{fmtDate(row.original.createdAt)}</span>,
      },
      {
        header: 'Plan',
        accessorKey: 'planCodeText',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => (
          <Link
            to="/plans/$id"
            params={{ id: row.original.planId }}
            className="mono"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {row.original.planCodeText}
          </Link>
        ),
      },
      {
        header: 'SO / JWSO No.',
        accessorKey: 'soCodeText',
        meta: { tdClass: 'mono' },
        cell: ({ row }) =>
          row.original.soCodeText ? (
            <span style={{ fontSize: 11 }}>
              {row.original.soCodeText}
              {row.original.lineNo ? <span className="text3">/{row.original.lineNo}</span> : null}
            </span>
          ) : (
            '—'
          ),
      },
      {
        // POL — the line number printed on the CUSTOMER's own purchase order,
        // off the SO line behind this Production Order. NOT our SO line number
        // (that is the "/n" in the SO / JWSO column to the left).
        header: () => <span style={{ color: 'var(--purple)' }}>POL</span>,
        id: 'clientPoLineNo',
        accessorKey: 'clientPoLineNo',
        meta: { tdClass: 'mono fw-700' },
        cell: ({ row }) => (
          <span style={{ color: 'var(--purple)' }}>{row.original.clientPoLineNo ?? '—'}</span>
        ),
      },
      {
        header: 'Item Code',
        accessorKey: 'itemCodeText',
        meta: { tdClass: 'td-code' },
        cell: ({ row }) => (
          <span className="td-code" style={{ color: 'var(--text)', fontWeight: 700 }}>
            {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
            {itemCodeWithRev(row.original.itemCodeText, row.original.itemRevision)}
          </span>
        ),
      },
      {
        header: 'Item Name',
        accessorKey: 'itemNameText',
        meta: { tdClass: 'text2' },
        cell: ({ row }) => row.original.itemNameText ?? '—',
      },
      {
        header: 'Order Qty',
        accessorKey: 'orderQty',
        meta: { tdClass: 'mono fw-700 td-num', thClass: 'th-num' },
      },
      {
        header: 'Customer Dispatch Date',
        accessorKey: 'targetDate',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{fmtDate(row.original.targetDate)}</span>,
      },
      {
        header: 'JC No.',
        accessorKey: 'jcCodeText',
        meta: { tdClass: 'td-code' },
        cell: ({ row }) => (
          <Link
            to="/job-cards/$id"
            params={{ id: row.original.jobCardId }}
            className="td-code"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {row.original.jcCodeText}
          </Link>
        ),
      },
      {
        header: 'Completed',
        accessorKey: 'jcFinishedQty',
        meta: { tdClass: 'mono fw-700 td-num', thClass: 'th-num' },
        cell: ({ row }) => (
          <span
            style={{
              color:
                row.original.jcFinishedQty >= row.original.orderQty
                  ? 'var(--green)'
                  : row.original.jcFinishedQty > 0
                    ? 'var(--amber)'
                    : 'var(--text3)',
            }}
          >
            {row.original.jcFinishedQty}
          </span>
        ),
      },
      {
        header: 'Production Order Status',
        accessorKey: 'status',
        cell: ({ row }) => <PoStatusBadge status={row.original.status} />,
      },
      {
        header: 'Close Date',
        accessorKey: 'closedAt',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {fmtDate(row.original.closedAt)}
          </span>
        ),
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. Sits
  // after every hook so the early return never trips rules-of-hooks.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div>
      {/* Frozen header band — title + count + search + New PO + the count strip
          stay pinned; the table scrolls under them. */}
      <ListHeader
        title="Production Orders"
        icon="🏭"
        count={total}
        noun="order"
        filterNote={
          search.status
            ? search.status === 'open'
              ? 'pending'
              : PRODUCTION_ORDER_STATUS_LABEL[search.status].toLowerCase()
            : undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search production order no, plan, POL, item, JC, SO…"
        updating={isFetching && !isLoading}
        primary={
          perms.entry ? (
            <Link to="/production-orders/new" className="btn btn-primary">
              <Plus size={14} /> New Production Order
            </Link>
          ) : null
        }
      >
        <StatStrip
          items={[
            {
              key: 'open',
              label: 'Open',
              count: openCount,
              color: 'var(--blue)',
              active: search.status === 'open',
              onClick: toggleStatus('open'),
              title: 'Open Production Orders — Job Card in progress or waiting to be closed',
            },
            {
              key: 'all',
              label: 'All',
              count: allCount,
              color: 'var(--cyan)',
              active: search.status === undefined,
              onClick: () => setStatusFilter(undefined),
              title: 'Clear the status filter',
            },
            {
              key: 'closed',
              label: 'Closed',
              count: closedCount,
              color: 'var(--green2)',
              active: search.status === 'closed',
              onClick: toggleStatus('closed'),
              title: 'Closed — stock credited with the finished qty',
            },
            {
              key: 'short_closed',
              label: PRODUCTION_ORDER_STATUS_LABEL.short_closed,
              count: shortClosedCount,
              color: 'var(--red2)',
              active: search.status === 'short_closed',
              onClick: toggleStatus('short_closed'),
            },
          ]}
        />
      </ListHeader>

      <div className="panel">
        <div className="tbl-wrap tbl-frozen">
          <table className="innovic-table tbl-grid">
            <SortableHead table={table} />
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="empty-state"
                    style={{ color: 'var(--red2)' }}
                  >
                    {error instanceof Error
                      ? error.message
                      : 'Could not load Production Orders. Try again.'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    {search.search || search.status
                      ? 'No production orders match.'
                      : 'No Production Orders yet.'}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() =>
                      void navigate({
                        to: '/production-orders/$id',
                        params: { id: row.original.id },
                      })
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cell.column.columnDef.meta?.tdClass}
                        // Sheet rule: codes, dates and qty stay on one line;
                        // only the item name may wrap.
                        style={
                          cell.column.id === 'itemNameText'
                            ? { textAlign: 'left' }
                            : { whiteSpace: 'nowrap' }
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isLoading || isError ? null : (
        <ListFooter total={total} noun="production order" limit={LIST_LIMIT} />
      )}
    </div>
  );
}
