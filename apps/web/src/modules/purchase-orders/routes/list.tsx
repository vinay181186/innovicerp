// Purchase Orders list (UI-003-04). Ports legacy renderPurchaseOrders L25209.
//
// Column order follows legacy L25350-25355: PO No. | Lines | Date | Vendor |
// SO/JW | Total Qty | Received | Pending | Value | Status | Actions.
//
// Legacy puts its cell classes on the <td> itself (e.g. `<td class="td-ctr mono
// fw-700">` for Total Qty), not on a wrapper span — `td-ctr` is
// text-align:center, which only takes effect on the block-level cell. Carry the
// class through the column def so the flexRender loop can put it where legacy
// has it (ISSUE-020).
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-030):
//  - No "Value" column (legacy L25256): the list payload carries no rate/value
//    aggregate (`purchaseOrderListItemSchema` has lineCount/totalQty/receivedQty
//    only), and summing it needs the lines. Not faked.
//  - "PR ref" occupies legacy's SO/JW slot: the payload has `prCodeText` but no
//    SO/JW back-reference (legacy reads first.soRefId → CASCADE.findOrder).
//  - No stat-card filter row (L25332-25345) and no "PO Creation Pending —
//    Approved PRs" panel (L25315-25331). See ISSUE-030.
//  - No expand-to-lines (L25276-25303) — the list payload has no lines — and so
//    the tip line at L25358 that advertises it is not shipped either (trap 1,
//    ISSUE-017).
//  - No Approve/Reject/Print row actions: see ISSUE-030. Both live on the
//    detail page, one click away via View.
//  - Search placeholder says what the API actually matches, not legacy's
//    "Search PO, vendor, item…" (trap 1 — legacy's box is a client-side filter
//    over rendered rows; ours is a server-side code/PR-ref/vendor-code match).

import {
  type ListPurchaseOrdersQuery,
  PO_STATUSES,
  PO_TYPES,
  type PoStatus,
  type PoType,
  type PurchaseOrderListItem,
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
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { useSession } from '@/lib/session';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseOrdersList } from '../api';
import { PoStatusBadge } from '../components/po-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PO_STATUSES).optional(),
  poType: z.enum(PO_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const purchaseOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders',
  validateSearch: listSearchSchema,
  component: PurchaseOrdersListPage,
});

function PurchaseOrdersListPage(): React.JSX.Element {
  const search = purchaseOrdersListRoute.useSearch();
  const navigate = purchaseOrdersListRoute.useNavigate();
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListPurchaseOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      poType: search.poType,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.poType, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseOrdersList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const columns = useMemo<ColumnDef<PurchaseOrderListItem>[]>(
    () => [
      // Legacy L25248: the type badge sits inside the PO No. cell, after the
      // code — it is not a column of its own. (The expand caret and the `Rev N`
      // tag are not ported: no line data on the list payload, no poRevision
      // field.)
      {
        header: 'PO No.',
        accessorKey: 'code',
        meta: { tdClass: 'td-code cyan' },
        cell: ({ row }) => {
          const isJW = row.original.poType === 'job_work';
          return (
            <>
              <Link
                to="/purchase-orders/$id"
                params={{ id: row.original.id }}
                style={{ color: 'inherit', fontWeight: 800, textDecoration: 'underline dotted' }}
              >
                {row.original.code}
              </Link>
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 3,
                  marginLeft: 6,
                  background: isJW ? 'rgba(196,122,0,0.12)' : 'rgba(0,136,187,0.12)',
                  color: isJW ? 'var(--amber)' : 'var(--cyan)',
                  border: `1px solid ${isJW ? 'rgba(196,122,0,0.3)' : 'rgba(0,136,187,0.3)'}`,
                  fontWeight: 700,
                }}
              >
                {isJW ? 'JW' : 'MAT'}
              </span>
            </>
          );
        },
      },
      {
        header: 'Lines',
        accessorKey: 'lineCount',
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.lineCount}</span>,
      },
      {
        header: 'Date',
        accessorKey: 'poDate',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.poDate}</span>,
      },
      {
        header: 'Vendor',
        id: 'vendor',
        accessorFn: (r) => r.vendorName ?? r.vendorCodeText ?? '',
        meta: { tdClass: 'fw-700' },
        cell: ({ row }) => (
          <span style={{ fontSize: 12 }}>
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
      },
      // Legacy's slot 5 is SO/JW (L25252). We have no SO/JW back-reference on
      // the payload; `prCodeText` is the upstream-document reference this port
      // does carry, so it takes the slot. See ISSUE-030.
      {
        header: 'PR ref',
        accessorKey: 'prCodeText',
        meta: { tdClass: 'mono text3' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.prCodeText ?? '—'}</span>,
      },
      {
        header: 'Total Qty',
        accessorKey: 'totalQty',
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => row.original.totalQty,
      },
      // Legacy L25254 is unconditionally green with no "/total" suffix — Total
      // Qty is the adjacent column and Pending is its own. The port's
      // green/amber/grey ramp was invented semantics; dropped (ISSUE-030).
      {
        header: 'Received',
        accessorKey: 'receivedQty',
        meta: { tdClass: 'td-ctr mono green fw-700' },
        cell: ({ row }) => row.original.receivedQty,
      },
      {
        header: 'Pending',
        id: 'pending',
        accessorFn: (r) => r.totalQty - r.receivedQty,
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => {
          const pend = row.original.totalQty - row.original.receivedQty;
          return (
            <span style={{ color: pend > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 700 }}>
              {pend}
            </span>
          );
        },
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <PoStatusBadge status={row.original.status} />,
      },
      // Legacy L25258-25274 (rowActions). View is legacy's primary button; the
      // rest are its dropdown items, rendered inline here because the
      // `.row-actions*` menu chrome is in no stylesheet (ISSUE-030).
      {
        header: 'Actions',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => {
          const po = row.original;
          return (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Link
                to="/purchase-orders/$id"
                params={{ id: po.id }}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '4px 10px' }}
                title="View"
              >
                👁 View
              </Link>
              {canWrite && po.status !== 'closed' ? (
                <Link
                  to="/purchase-orders/$id/edit"
                  params={{ id: po.id }}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  ✎ Edit
                </Link>
              ) : null}
              {canWrite && po.poType === 'job_work' && po.status !== 'draft' ? (
                <Link
                  to="/delivery-challans/new"
                  search={{ poId: po.id }}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  📦 Create DC
                </Link>
              ) : null}
              {po.status !== 'closed' && po.status !== 'cancelled' ? (
                <AssignTaskButton
                  linkedRef={{
                    type: 'purchase_order',
                    id: po.id,
                    display: `PO ${po.code}`,
                    navPage: `/purchase-orders/${po.id}`,
                  }}
                  suggestedTitle={`Follow up ${po.code}`}
                  label=""
                />
              ) : null}
            </div>
          );
        },
      },
    ],
    [canWrite],
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

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  // Legacy L25347-25348: when a filter is on, the panel title names it and a
  // "Show All" button clears it. Legacy's `_poFlt` is set by the stat cards;
  // ours by the status / type selects, which drive the same table.
  const activeFilter = [search.status, search.poType]
    .filter((v): v is PoStatus | PoType => Boolean(v))
    .map((v) => v.replaceAll('_', ' '))
    .join(', ');

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🛒 Purchase Orders
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search code, PR ref, vendor code…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as PoStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All statuses</option>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          <select
            className="innovic-select"
            value={search.poType ?? ''}
            onChange={(e) => {
              const v = e.target.value as PoType | '';
              void navigate({
                search: (prev) => ({ ...prev, poType: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All types</option>
            {PO_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/purchase-orders/new" className="btn btn-primary">
              <Plus size={14} /> New PO
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            Purchase Orders{' '}
            {activeFilter ? (
              <span className="amber" style={{ fontSize: 12 }}>
                ({activeFilter})
              </span>
            ) : null}
          </span>
          {activeFilter ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, status: undefined, poType: undefined, page: 1 }),
                  replace: true,
                })
              }
            >
              Show All
            </button>
          ) : null}
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
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
                    style={{ color: 'var(--red)' }}
                  >
                    {error instanceof Error ? error.message : 'Failed to load purchase orders'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No purchase orders yet
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cell.column.columnDef.meta?.tdClass}>
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

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No purchase orders'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
