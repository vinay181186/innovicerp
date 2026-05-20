// Purchase Requests list (UI-003-04).

import {
  type ListPurchaseRequestsQuery,
  PR_STATUSES,
  type PrStatus,
  type PurchaseRequestListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseRequestsList } from '../api';
import { PrStatusBadge } from '../components/pr-status-badge';

const PAGE_SIZE = 25;

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

  const columns = useMemo<ColumnDef<PurchaseRequestListItem>[]>(
    () => [
      {
        header: 'PR No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/purchase-requests/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'prDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.prDate}
          </span>
        ),
      },
      {
        header: 'Vendor',
        cell: ({ row }) => (
          <span style={{ fontSize: 12 }}>
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Item',
        cell: ({ row }) => (
          <span className="td-code mono" style={{ fontSize: 11 }}>
            {row.original.itemCode ?? row.original.itemCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Operation',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            {row.original.operation ?? '—'}
          </span>
        ),
      },
      {
        header: 'Qty',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.qty}</span>,
      },
      {
        header: 'Source JC',
        cell: ({ row }) =>
          row.original.sourceJcCode ? (
            <span className="mono" style={{ fontSize: 11 }}>
              {row.original.sourceJcCode} · op {row.original.sourceJcOpSeq}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        header: 'PO',
        cell: ({ row }) =>
          row.original.poCode ? (
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--green2)', fontWeight: 700 }}
            >
              {row.original.poCode}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <PrStatusBadge status={row.original.status} />,
      },
    ],
    [],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, operation, item name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as PrStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
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
          {canWrite ? (
            <Link to="/purchase-requests/new" className="btn btn-primary">
              <Plus size={14} /> New PR
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th key={header.id}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
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
                    No purchase requests
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
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
