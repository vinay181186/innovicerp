// Delivery-challans list (UI-003-06).

import {
  DC_STATUSES,
  type DcStatus,
  type DeliveryChallanListItem,
  type ListDeliveryChallansQuery,
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
import { ChevronLeft, ChevronRight, Loader2, Plus, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeliveryChallansList } from '../api';
import { DcStatusBadge } from '../components/dc-status-badge';
import { printDispatchRegister } from '../lib/print-dispatch-register';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(DC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const deliveryChallansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans',
  validateSearch: listSearchSchema,
  component: DeliveryChallansListPage,
});

function DeliveryChallansListPage(): React.JSX.Element {
  const search = deliveryChallansListRoute.useSearch();
  const navigate = deliveryChallansListRoute.useNavigate();

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

  const query: ListDeliveryChallansQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useDeliveryChallansList(query);
  const { data: company } = useMyCompany();

  const onPrintRegister = (): void => {
    if (!data) return;
    const parts: string[] = [];
    if (search.search) parts.push(`search "${search.search}"`);
    if (search.status) parts.push(`status ${search.status.replaceAll('_', ' ')}`);
    const pages = Math.max(1, Math.ceil((data.total ?? 0) / PAGE_SIZE));
    parts.push(`page ${search.page} of ${pages}`);
    const ok = printDispatchRegister({
      rows: data.items,
      summary: data.summary,
      filterLabel: parts.join(' · '),
      company,
    });
    if (!ok) window.alert('Allow popups to print.');
  };

  const columns = useMemo<ColumnDef<DeliveryChallanListItem>[]>(
    () => [
      {
        header: 'DC No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/delivery-challans/$id"
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
        accessorKey: 'dcDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.dcDate}
          </span>
        ),
      },
      {
        header: 'Vendor',
        id: 'vendor',
        accessorFn: (r) => r.vendorName ?? r.vendorCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            {row.original.vendorName ?? (
              <span className="text3">{row.original.vendorCodeText}</span>
            )}
          </span>
        ),
      },
      {
        header: 'PO',
        id: 'po',
        accessorFn: (r) => r.poCode ?? r.poCodeText ?? '',
        cell: ({ row }) => {
          if (row.original.poCode) {
            return (
              <span
                className="badge b-green"
                title={`Linked PO ${row.original.poCode}`}
                style={{ fontSize: 11 }}
              >
                {row.original.poCode}
              </span>
            );
          }
          if (row.original.poCodeText) {
            return (
              <span
                className="badge b-amber"
                title="Snapshot text — no PO linked. Will mismatch if the PO is renumbered."
                style={{ fontSize: 11 }}
              >
                {row.original.poCodeText}*
              </span>
            );
          }
          return <span className="text3">—</span>;
        },
      },
      {
        header: 'SO',
        id: 'so',
        accessorFn: (r) => r.soCode ?? r.soRefText ?? '',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11 }}>
            {row.original.soCode ?? row.original.soRefText ?? '—'}
          </span>
        ),
      },
      {
        header: 'Lines',
        accessorKey: 'lineCount',
        cell: ({ row }) => (
          <span className="td-ctr mono fw-700">{row.original.lineCount}</span>
        ),
      },
      {
        header: 'Total qty',
        id: 'totalQty',
        accessorFn: (r) => Number(r.totalQty),
        cell: ({ row }) => (
          <span className="td-ctr mono">{Number(row.original.totalQty).toFixed(2)}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <DcStatusBadge status={row.original.status} />,
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
          🚛 OSP / JW Outward DC
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search DC code, vendor, item…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as DcStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 160, fontSize: 12 }}
          >
            <option value="">All statuses</option>
            {DC_STATUSES.map((s) => (
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onPrintRegister}
            disabled={isLoading || !data}
            title="Print the dispatch register for the current filter/page"
          >
            <Printer size={14} /> Print Register
          </button>
          <Link to="/purchase-orders" className="btn btn-primary">
            <Plus size={14} /> New DC (via PO)
          </Link>
        </div>
      </div>

      {data?.summary ? <DispatchKpiStrip summary={data.summary} /> : null}

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ⚠️ DCs are issued against PO_jw. Create from a PO detail page → "Issue DC". Receive
            back from the DC detail page.
          </span>
        </div>
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
                  <td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load DCs'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No DCs
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
            ? 'No DCs'
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

// PL-DR-1b — KPI strip mirroring legacy renderDispatchRegister L10756–10770.
// 3 tiles in a 3-col auto-fit grid: Total Dispatched (red), Dispatch Entries
// (default), Items Dispatched (cyan).
function DispatchKpiStrip({
  summary,
}: {
  summary: { totalDispatched: number; entryCount: number; itemCount: number };
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
        marginBottom: 16,
      }}
    >
      <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 6,
          }}
        >
          Total Dispatched
        </div>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--red)',
          }}
        >
          {summary.totalDispatched.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>pieces</div>
      </div>
      <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 6,
          }}
        >
          Dispatch Entries
        </div>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 28,
            fontWeight: 800,
          }}
        >
          {summary.entryCount}
        </div>
      </div>
      <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--text3)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 6,
          }}
        >
          Items Dispatched
        </div>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 28,
            fontWeight: 800,
            color: 'var(--cyan)',
          }}
        >
          {summary.itemCount}
        </div>
      </div>
    </div>
  );
}
