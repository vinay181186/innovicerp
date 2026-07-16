// Purchase Requests list (UI-003-04).
// Ports legacy renderPurchaseRequests (legacy/InnovicERP_v82_12_3_DataLossFix
// _29-04-2026.html L6217-6310): status cards → filter row → table with legacy
// column order (PR No. | Dates | SO / JC | Operation | Item | Vendor | Qty |
// Est. Cost | Req. Date | Status | Actions).
//
// Legacy deltas kept deliberately (see docs/ISSUES.md ISSUE-025..027):
//  - No checkbox column / "🛒 Create PO from Selected" and no SO filter: the
//    club-PO flow is ported on /outsource-jobs (from-pr-batch) and the list API
//    has no SO/JC filter param. The legacy tip line that advertises both is
//    therefore not shipped either.
//  - No Approve / Cancel row buttons: there is no approve endpoint, and PATCH
//    status alone would skip legacy's approvedBy/approvedDate stamp and
//    cancelPR's upstream JC-op/plan reset (ISSUE-025).
//  - Card headings say "Open" where legacy says "Pending" — `open` is this
//    port's status name, shown by the badge and the status filter on this same
//    page.

import {
  type ListPurchaseRequestsQuery,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequestListItem,
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
import { authenticatedRoute } from '@/routes/_authenticated';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { usePurchaseRequestsList } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

// Legacy puts its cell classes on the <td> itself (e.g. `<td class="td-ctr mono
// fw-700">` for Qty), not on a wrapper span — td-ctr is text-align:center,
// which only takes effect on the block-level cell. Carry the class through the
// column def so the flexRender loop can put it where legacy has it (ISSUE-020).
const PAGE_SIZE = 25;

// Legacy's cards count every PR regardless of the search box / SO filter
// (renderPurchaseRequests L6221-6223 counts the whole array). Module-level
// constants keep the query keys stable so these are fetched once and cached.
const COUNT_ALL: ListPurchaseRequestsQuery = { limit: 1, offset: 0 };
const COUNT_OPEN: ListPurchaseRequestsQuery = { status: 'open', limit: 1, offset: 0 };
const COUNT_APPROVED: ListPurchaseRequestsQuery = { status: 'approved', limit: 1, offset: 0 };
const COUNT_PO_CREATED: ListPurchaseRequestsQuery = { status: 'po_created', limit: 1, offset: 0 };

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(PR_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const purchaseRequestsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-requests',
  validateSearch: listSearchSchema,
  component: PurchaseRequestsListPage,
});

function PurchaseRequestsListPage(): React.JSX.Element {
  const search = purchaseRequestsListRoute.useSearch();
  const navigate = purchaseRequestsListRoute.useNavigate();
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

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = usePurchaseRequestsList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  // Legacy status cards (L6229-6242) count the whole PR set, not the filtered
  // page — the list endpoint returns a `total` per filter, so one count query
  // per card band.
  const allCount = usePurchaseRequestsList(COUNT_ALL).data?.total ?? 0;
  const openCount = usePurchaseRequestsList(COUNT_OPEN).data?.total ?? 0;
  const approvedCount = usePurchaseRequestsList(COUNT_APPROVED).data?.total ?? 0;
  const poCreatedCount = usePurchaseRequestsList(COUNT_PO_CREATED).data?.total ?? 0;

  const setStatusFilter = (next: PrStatus | undefined): void => {
    void navigate({
      search: (prev) => ({ ...prev, status: next, page: 1 }),
      replace: true,
    });
  };

  const columns = useMemo<ColumnDef<PurchaseRequestListItem>[]>(
    () => [
      {
        header: 'PR No.',
        accessorKey: 'code',
        meta: { tdClass: 'mono fw-700' },
        cell: ({ row }) => (
          <Link
            to="/purchase-requests/$id"
            params={{ id: row.original.id }}
            className="td-code cyan"
            style={{ fontWeight: 700 }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Dates',
        accessorKey: 'prDate',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            {row.original.prDate}
            {row.original.approvedAt ? (
              <>
                <br />
                <span style={{ fontSize: 9, color: 'var(--blue)' }}>
                  ✔ {row.original.approvedAt.slice(0, 10)}
                </span>
              </>
            ) : null}
            {row.original.poCreatedAt ? (
              <>
                <br />
                <span style={{ fontSize: 9, color: 'var(--green)' }}>
                  📝 {row.original.poCreatedAt.slice(0, 10)}
                </span>
              </>
            ) : null}
          </span>
        ),
      },
      {
        header: 'SO / JC',
        accessorKey: 'sourceJcCode',
        meta: { tdClass: 'mono' },
        cell: ({ row }) =>
          row.original.sourceJcCode ? (
            <span style={{ fontSize: 11, color: 'var(--cyan)' }}>
              {row.original.sourceJcCode}
              {row.original.sourceJcOpSeq ? (
                <span className="text3"> · op {row.original.sourceJcOpSeq}</span>
              ) : null}
            </span>
          ) : (
            <span className="text3" style={{ fontSize: 11 }}>
              —
            </span>
          ),
      },
      {
        header: 'Operation',
        accessorKey: 'operation',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.operation ?? ''}</span>,
      },
      {
        header: 'Item',
        id: 'item',
        accessorFn: (r) => r.itemCode ?? r.itemCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            <span className="mono" style={{ color: 'var(--purple)' }}>
              {row.original.itemCode ?? row.original.itemCodeText ?? '—'}
            </span>{' '}
            {row.original.itemName ?? ''}
          </span>
        ),
      },
      {
        header: 'Vendor',
        id: 'vendor',
        accessorFn: (r) => r.vendorName ?? r.vendorCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--amber)' }}>
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Qty',
        accessorKey: 'qty',
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => row.original.qty,
      },
      {
        header: 'Est. Cost',
        id: 'estCost',
        accessorFn: (r) => Number(r.estCost),
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            {Number(row.original.estCost) > 0 ? `₹${Number(row.original.estCost).toFixed(2)}` : '—'}
          </span>
        ),
      },
      {
        header: 'Req. Date',
        accessorKey: 'requiredDate',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>{row.original.requiredDate ?? '—'}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <PrStatusBadge status={row.original.status} />,
      },
      {
        header: 'Actions',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => {
          const pr = row.original;
          return (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {canWrite && (pr.status === 'open' || pr.status === 'approved') ? (
                <Link
                  to="/purchase-orders/from-pr"
                  search={{ prId: pr.id }}
                  className="btn btn-sm btn-success"
                  style={{ fontSize: 10 }}
                >
                  📝 PO
                </Link>
              ) : null}
              {pr.status === 'po_created' && pr.poId && pr.poCode ? (
                <Link
                  to="/purchase-orders/$id"
                  params={{ id: pr.poId }}
                  className="mono cyan"
                  style={{ fontSize: 11, textDecoration: 'underline dotted' }}
                >
                  {pr.poCode}
                </Link>
              ) : null}
              {pr.status !== 'cancelled' && pr.status !== 'po_created' ? (
                <AssignTaskButton
                  linkedRef={{
                    type: 'purchase_request',
                    id: pr.id,
                    display: `PR ${pr.code}`,
                    navPage: `/purchase-requests/${pr.id}`,
                  }}
                  suggestedTitle={
                    pr.status === 'open'
                      ? `Review & approve ${pr.code}`
                      : `Convert ${pr.code} to PO`
                  }
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
          Purchase Requests
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canWrite ? (
            <Link to="/purchase-requests/new" className="btn btn-primary">
              <Plus size={14} /> New PR
            </Link>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatusCard
          label="Open"
          count={openCount}
          color="var(--amber)"
          active={search.status === 'open'}
          onClick={() => setStatusFilter(search.status === 'open' ? undefined : 'open')}
        />
        <StatusCard
          label="Approved (Awaiting PO)"
          count={approvedCount}
          color="var(--blue)"
          active={search.status === 'approved'}
          onClick={() => setStatusFilter(search.status === 'approved' ? undefined : 'approved')}
        />
        <StatusCard
          label="PO Created"
          count={poCreatedCount}
          color="var(--green)"
          active={search.status === 'po_created'}
          onClick={() => setStatusFilter(search.status === 'po_created' ? undefined : 'po_created')}
        />
        <StatusCard
          label="All PRs"
          count={allCount}
          active={search.status === undefined}
          activeColor="var(--cyan)"
          onClick={() => setStatusFilter(undefined)}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <input
          className="innovic-input"
          placeholder="🔍 Search PRs..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: 240, fontSize: 12 }}
        />
        <select
          className="innovic-select"
          value={search.status ?? ''}
          onChange={(e) => {
            const v = e.target.value as PrStatus | '';
            setStatusFilter(v === '' ? undefined : v);
          }}
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">All statuses</option>
          {PR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
      </div>

      <div className="panel">
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
                    {error instanceof Error ? error.message : 'Failed to load purchase requests'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No purchase requests found
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
            ? 'No purchase requests'
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

/** Legacy PR status card (renderPurchaseRequests L6229-6242): count + label,
 *  click toggles the status filter, active card gets a coloured border. */
function StatusCard(props: {
  label: string;
  count: number;
  color?: string;
  activeColor?: string;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const borderColor = props.active ? (props.activeColor ?? props.color ?? 'var(--cyan)') : 'transparent';
  return (
    <div
      className="panel"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') props.onClick();
      }}
      style={{
        minWidth: 140,
        padding: 14,
        textAlign: 'center',
        cursor: 'pointer',
        border: `2px solid ${borderColor}`,
      }}
    >
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase' }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 28, color: props.color }}>
        {props.count}
      </div>
    </div>
  );
}
