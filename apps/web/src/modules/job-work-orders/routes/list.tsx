// JW Master list (UI-003-04). Ports legacy renderJWMaster L12642.

import {
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
  SO_STATUSES,
  type SoStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrdersList } from '../api';
import { JwMaterialStatusBadge } from '../components/jw-material-status';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(SO_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const jobWorkOrdersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders',
  validateSearch: listSearchSchema,
  component: JobWorkOrdersListPage,
});

function JobWorkOrdersListPage(): React.JSX.Element {
  const search = jobWorkOrdersListRoute.useSearch();
  const navigate = jobWorkOrdersListRoute.useNavigate();
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

  const query: ListJobWorkOrdersQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useJobWorkOrdersList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const columns = useMemo<ColumnDef<JobWorkOrderListItem>[]>(
    () => [
      {
        header: 'JW No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/job-work-orders/$id"
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
        accessorKey: 'jwDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.jwDate}
          </span>
        ),
      },
      {
        header: 'Client',
        cell: ({ row }) => <span className="fw-700">{row.original.customerName ?? '—'}</span>,
      },
      {
        header: 'Lines',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.lineCount}</span>,
      },
      {
        header: 'Total Qty',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.totalQty}</span>,
      },
      {
        header: 'JC Qty',
        cell: ({ row }) => {
          const jc = row.original.jcQty;
          const total = row.original.totalQty;
          const color =
            jc >= total && total > 0
              ? 'var(--green)'
              : jc > 0
                ? 'var(--amber)'
                : 'var(--text3)';
          return (
            <span className="td-ctr mono" style={{ color, fontWeight: 700 }}>
              {jc}
              <span className="text3" style={{ fontSize: 10 }}>
                {' '}
                /{total}
              </span>
            </span>
          );
        },
      },
      {
        header: 'Material',
        cell: ({ row }) => (
          <JwMaterialStatusBadge
            receivedQty={Number(row.original.materialReceivedQtyTotal)}
            expectedQty={Number(row.original.clientMaterialQtyTotal)}
          />
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <SoStatusBadge status={row.original.status} />,
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
          JW Master — Job Work (Material from Client)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search JW, client, item…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as SoStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All statuses</option>
            {SO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/job-work-orders/new" className="btn btn-primary">
              <Plus size={14} /> New JW Order
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            📌 <b style={{ color: 'var(--green)' }}>Job Work:</b> Client provides raw material → we
            machine / process it → deliver finished parts back to client.
          </span>
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
                    {error instanceof Error ? error.message : 'Failed to load job-work orders'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No Job Work orders — click <strong>+ New JW Order</strong>
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

      <PaginationFooter
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={PAGE_SIZE}
        emptyLabel="No job-work orders"
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />
    </div>
  );
}

function PaginationFooter(props: {
  total: number;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  emptyLabel: string;
  onPage: (page: number) => void;
}): React.JSX.Element {
  const { total, currentPage, totalPages, pageSize, emptyLabel, onPage } = props;
  return (
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
          ? emptyLabel
          : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} of ${total}`}
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={currentPage <= 1}
          onClick={() => onPage(Math.max(1, currentPage - 1))}
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
          onClick={() => onPage(Math.min(totalPages, currentPage + 1))}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
