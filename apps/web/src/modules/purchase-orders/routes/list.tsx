// Purchase Orders list (UI-003-04). Ports legacy renderPurchaseOrders L25209.

import {
  type ListPurchaseOrdersQuery,
  PO_STATUSES,
  PO_TYPES,
  type PoStatus,
  type PoType,
  type PurchaseOrderListItem,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
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
      {
        header: 'PO No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/purchase-orders/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--cyan)', fontWeight: 800, textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'poType',
        cell: ({ row }) => {
          const t = row.original.poType;
          const isJW = t === 'job_work';
          return (
            <span
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 3,
                background: isJW ? 'rgba(196,122,0,0.12)' : 'rgba(0,136,187,0.12)',
                color: isJW ? 'var(--amber)' : 'var(--cyan)',
                border: `1px solid ${isJW ? 'rgba(196,122,0,0.3)' : 'rgba(0,136,187,0.3)'}`,
                fontWeight: 700,
              }}
            >
              {isJW ? 'JW' : 'MAT'}
            </span>
          );
        },
      },
      {
        header: 'Date',
        accessorKey: 'poDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.poDate}
          </span>
        ),
      },
      {
        header: 'Vendor',
        cell: ({ row }) => (
          <span className="fw-700" style={{ fontSize: 12 }}>
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Lines',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.lineCount}</span>,
      },
      {
        header: 'Total Qty',
        cell: ({ row }) => <span className="td-ctr mono fw-700">{row.original.totalQty}</span>,
      },
      {
        header: 'Received',
        cell: ({ row }) => {
          const r = row.original.receivedQty;
          const t = row.original.totalQty;
          const color =
            r >= t && t > 0 ? 'var(--green)' : r > 0 ? 'var(--amber)' : 'var(--text3)';
          return (
            <span className="td-ctr mono" style={{ color, fontWeight: 700 }}>
              {r}
              <span className="text3" style={{ fontSize: 10 }}>
                {' '}
                /{t}
              </span>
            </span>
          );
        },
      },
      {
        header: 'PR ref',
        cell: ({ row }) => (
          <span className="mono text3" style={{ fontSize: 11 }}>
            {row.original.prCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <PoStatusBadge status={row.original.status} />,
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
          Purchase Orders
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, PR ref, vendor code…"
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
                    {error instanceof Error ? error.message : 'Failed to load purchase orders'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No purchase orders
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
