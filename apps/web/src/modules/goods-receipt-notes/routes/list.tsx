// GRN list (UI-003-05). Ports legacy renderGRN L26444.

import {
  GRN_QC_STATUSES,
  type GoodsReceiptNoteListItem,
  type GrnQcStatus,
  type ListGoodsReceiptNotesQuery,
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
import { useGoodsReceiptNotesList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  qcStatus: z.enum(GRN_QC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const goodsReceiptNotesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes',
  validateSearch: listSearchSchema,
  component: GoodsReceiptNotesListPage,
});

function GoodsReceiptNotesListPage(): React.JSX.Element {
  const search = goodsReceiptNotesListRoute.useSearch();
  const navigate = goodsReceiptNotesListRoute.useNavigate();
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

  const query: ListGoodsReceiptNotesQuery = useMemo(
    () => ({
      search: search.search,
      qcStatus: search.qcStatus,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.qcStatus, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useGoodsReceiptNotesList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const columns = useMemo<ColumnDef<GoodsReceiptNoteListItem>[]>(
    () => [
      {
        header: 'GRN No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/goods-receipt-notes/$id"
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
        accessorKey: 'grnDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.grnDate}
          </span>
        ),
      },
      {
        header: 'PO',
        id: 'po',
        accessorFn: (r) => r.poCode ?? r.poCodeText ?? '',
        cell: ({ row }) =>
          row.original.poCode ? (
            <span className="mono" style={{ fontSize: 11 }}>
              {row.original.poCode}
            </span>
          ) : (
            <span className="text3" style={{ fontSize: 11 }}>
              {row.original.poCodeText ?? '—'}
            </span>
          ),
      },
      {
        header: 'Vendor',
        id: 'vendor',
        accessorFn: (r) => r.vendorName ?? r.vendorCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontSize: 12 }}>
            {row.original.vendorName ?? row.original.vendorCodeText ?? '—'}
          </span>
        ),
      },
      {
        header: 'DC',
        accessorKey: 'dcNo',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11 }}>
            {row.original.dcNo ?? '—'}
          </span>
        ),
      },
      {
        header: 'Lines',
        accessorKey: 'lineCount',
        cell: ({ row }) => <span className="td-ctr mono">{row.original.lineCount}</span>,
      },
      {
        header: 'Received',
        accessorKey: 'totalReceivedQty',
        cell: ({ row }) => (
          <span className="td-ctr mono fw-700">{row.original.totalReceivedQty}</span>
        ),
      },
      {
        // Legacy renderGRN L26468 — QC Accepted total across lines (green).
        header: 'QC Accepted',
        accessorKey: 'totalQcAcceptedQty',
        cell: ({ row }) => (
          <span
            className="td-ctr mono fw-700"
            style={{ color: 'var(--green)' }}
          >
            {row.original.totalQcAcceptedQty}
          </span>
        ),
      },
      {
        // Legacy renderGRN L26469 — QC Rejected total across lines (red).
        header: 'QC Rejected',
        accessorKey: 'totalQcRejectedQty',
        cell: ({ row }) => (
          <span
            className="td-ctr mono"
            style={{ color: 'var(--red)', fontWeight: 700 }}
          >
            {row.original.totalQcRejectedQty}
          </span>
        ),
      },
      {
        header: 'QC pending',
        accessorKey: 'qcPendingCount',
        cell: ({ row }) => {
          const p = row.original.qcPendingCount;
          return (
            <span
              className="td-ctr mono"
              style={{ color: p === 0 ? 'var(--green)' : 'var(--amber)', fontWeight: 700 }}
            >
              {p}
            </span>
          );
        },
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
          📥 Goods Receipt Note (GRN)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, PO ref, DC, invoice…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.qcStatus ?? ''}
            onChange={(e) => {
              const v = e.target.value as GrnQcStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, qcStatus: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 160, fontSize: 12 }}
          >
            <option value="">All QC statuses</option>
            {GRN_QC_STATUSES.map((s) => (
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
            <Link to="/goods-receipt-notes/new" className="btn btn-primary">
              <Plus size={14} /> New GRN
            </Link>
          ) : null}
        </div>
      </div>

      {data?.summary ? (
        <GrnKpiStrip
          summary={data.summary}
          activeStatus={search.qcStatus ?? null}
          onSelectStatus={(s) => {
            void navigate({
              search: (prev) => ({ ...prev, qcStatus: s, page: 1 }),
              replace: true,
            });
          }}
        />
      ) : null}

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            💡 GRN creates receipt record with <b>QC Pending</b> status. Go to{' '}
            <b>Incoming QC</b> to inspect and accept/reject. Only QC-accepted qty moves to Store
            inventory.
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
                    {error instanceof Error ? error.message : 'Failed to load goods receipt notes'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No goods receipt notes
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
            ? 'No goods receipt notes'
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

// PL-GRN-1b — 4-tile stat strip mirroring legacy renderGRN L26483–26488.
// Clicking Total / QC Pending / QC Cleared filters by qcStatus. Today
// is informational (we don't have a "filter by today's date" yet — the
// Today tile shows the count for context only).
function GrnKpiStrip({
  summary,
  activeStatus,
  onSelectStatus,
}: {
  summary: { total: number; qcPending: number; qcCleared: number; today: number };
  activeStatus: GrnQcStatus | null;
  onSelectStatus: (next: GrnQcStatus | undefined) => void;
}): React.JSX.Element {
  const tiles: Array<{
    key: 'all' | 'qcpending' | 'qccleared' | 'today';
    label: string;
    value: number;
    color: string;
    onClick?: () => void;
    active: boolean;
    sub?: string;
  }> = [
    {
      key: 'all',
      label: 'Total GRNs',
      value: summary.total,
      color: 'var(--cyan)',
      onClick: () => onSelectStatus(undefined),
      active: activeStatus === null,
    },
    {
      key: 'qcpending',
      label: 'QC Pending',
      value: summary.qcPending,
      color: 'var(--amber)',
      onClick: () => onSelectStatus('pending'),
      active: activeStatus === 'pending',
      sub: '→ Go to Incoming QC',
    },
    {
      key: 'qccleared',
      label: 'QC Cleared',
      value: summary.qcCleared,
      color: 'var(--green)',
      onClick: () => onSelectStatus('completed'),
      active: activeStatus === 'completed',
    },
    {
      key: 'today',
      label: 'Today',
      value: summary.today,
      color: 'var(--blue)',
      active: false,
    },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 16,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.key}
          onClick={t.onClick}
          style={{
            padding: 14,
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderTop: `3px solid ${t.color}`,
            borderRadius: 6,
            cursor: t.onClick ? 'pointer' : 'default',
            boxShadow: t.active ? `0 0 0 2px ${t.color}` : undefined,
            transition: 'box-shadow .15s',
            textAlign: 'center',
          }}
        >
          <div
            className="text3"
            style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
          >
            {t.label}
          </div>
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 22,
              fontWeight: 700,
              color: t.color,
              marginTop: 2,
            }}
          >
            {t.value}
          </div>
          {t.sub ? (
            <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
              {t.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
