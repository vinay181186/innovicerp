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
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
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
        // Legacy L26462 — <td class="td-code cyan">. Legacy renders plain text;
        // the React port links to the GRN detail page (kept — extra affordance).
        header: 'GRN No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/goods-receipt-notes/$id"
            params={{ id: row.original.id }}
            className="td-code cyan"
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        // Legacy L26463 — <td style="font-size:11px">.
        header: 'Date',
        accessorKey: 'grnDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.grnDate}
          </span>
        ),
      },
      {
        // Legacy L26464/L26494 — <td class="mono"> header "PO/JWPO".
        header: 'PO/JWPO',
        id: 'po',
        accessorFn: (r) => r.poCode ?? r.poCodeText ?? '',
        meta: { tdClass: 'mono' },
        cell: ({ row }) =>
          row.original.poCode ? (
            <span style={{ fontSize: 11 }}>{row.original.poCode}</span>
          ) : (
            <span className="text3" style={{ fontSize: 11 }}>
              {row.original.poCodeText ?? '—'}
            </span>
          ),
      },
      {
        // Legacy L26465 — <td class="fw-700" style="font-size:12px">.
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
      {
        // Occupies legacy's "Item Code" slot (L26466). Legacy GRN is flat —
        // one item per receipt — so it prints a single itemCode. Our GRN is
        // header+lines (ADR-015), and the list row carries no item code, so
        // this surfaces the line count instead. See report: Item Code needs
        // an API change to render here.
        header: 'Lines',
        accessorKey: 'lineCount',
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => row.original.lineCount,
      },
      {
        // Legacy L26467 — <td class="td-ctr mono fw-700">.
        header: 'Received',
        accessorKey: 'totalReceivedQty',
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => row.original.totalReceivedQty,
      },
      {
        // Legacy L26468 — <td class="td-ctr mono fw-700" style="color:var(--green)">.
        header: () => <span className="green">QC Accepted</span>,
        accessorKey: 'totalQcAcceptedQty',
        meta: { tdClass: 'td-ctr mono fw-700 green' },
        cell: ({ row }) => row.original.totalQcAcceptedQty,
      },
      {
        // Legacy L26469 — <td class="td-ctr mono" style="color:var(--red)">.
        // Legacy deliberately omits fw-700 here (Accepted has it, Rejected does not).
        header: () => <span className="red">QC Rejected</span>,
        accessorKey: 'totalQcRejectedQty',
        meta: { tdClass: 'td-ctr mono red' },
        cell: ({ row }) => row.original.totalQcRejectedQty,
      },
      {
        // No legacy equivalent column — legacy shows a header-level QC Status
        // badge here (L26470), which our list row cannot express (QC status is
        // per line). Kept: it is the closest working signal we have.
        header: 'QC pending',
        accessorKey: 'qcPendingCount',
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => {
          const p = row.original.qcPendingCount;
          return <span className={p === 0 ? 'green' : 'amber'}>{p}</span>;
        },
      },
      {
        // Legacy L26471/L26498 — "Ref" column: invoice no. then DC no.
        // <td style="font-size:10px;color:var(--text3)">.
        header: 'Ref',
        id: 'ref',
        accessorFn: (r) => [r.invoiceNo, r.dcNo].filter(Boolean).join(' '),
        meta: { tdClass: 'text3' },
        cell: ({ row }) => (
          <span style={{ fontSize: 10 }}>
            {[row.original.invoiceNo, row.original.dcNo].filter(Boolean).join(' ')}
          </span>
        ),
      },
      {
        // Legacy L26458-26460/L26472 — trailing blank-header column holding the
        // "assign to QC user" button. Legacy gates on qcStatus==='Pending';
        // our nearest signal is "has any line awaiting QC" (qcPendingCount>0),
        // which also covers legacy's 'Partial'. AssignTaskButton self-gates to
        // admin/manager.
        header: '',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.qcPendingCount > 0 ? (
            <AssignTaskButton
              linkedRef={{
                type: 'GRN',
                id: row.original.id,
                display: row.original.code,
                navPage: '/incoming-qc',
              }}
              suggestedTitle={`Inspect ${row.original.code}`}
            />
          ) : null,
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

      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            GRN Register{' '}
            {search.qcStatus ? (
              <span className="amber" style={{ fontSize: 12 }}>
                ({search.qcStatus.replaceAll('_', ' ')})
              </span>
            ) : null}
          </span>
          {search.qcStatus ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, qcStatus: undefined, page: 1 }),
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
                  <td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load goods receipt notes'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No GRN entries yet
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

      {/* Legacy L26502-26503 — plain tip line under the register panel. */}
      <div className="text3" style={{ fontSize: 11, marginTop: 8, padding: '0 4px' }}>
        💡 GRN creates receipt record with <b>QC Pending</b> status. Go to <b>Incoming QC</b> to
        inspect and accept/reject. Only QC-accepted qty moves to Store inventory.
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
    /** stat-card accent variant (legacy L26484-26487). */
    variant: string;
    accent: string;
    onClick?: () => void;
    active: boolean;
    sub?: string;
  }> = [
    {
      key: 'all',
      label: 'Total GRNs',
      value: summary.total,
      variant: 'cyan',
      accent: 'var(--cyan)',
      onClick: () => onSelectStatus(undefined),
      active: activeStatus === null,
    },
    {
      key: 'qcpending',
      label: 'QC Pending',
      value: summary.qcPending,
      variant: 'amber',
      accent: 'var(--amber)',
      onClick: () => onSelectStatus('pending'),
      active: activeStatus === 'pending',
      sub: '→ Go to Incoming QC',
    },
    {
      key: 'qccleared',
      label: 'QC Cleared',
      value: summary.qcCleared,
      variant: 'green',
      accent: 'var(--green)',
      onClick: () => onSelectStatus('completed'),
      active: activeStatus === 'completed',
    },
    {
      // `blue` is intentionally accent-less: legacy writes `stat-card blue`
      // here (L26487) but only ever defines cyan/amber/green/red (L97-102), so
      // this tile has no accent bar in legacy either. Matching that is correct;
      // adding a .blue rule would diverge.
      key: 'today',
      label: 'Today',
      value: summary.today,
      variant: 'blue',
      accent: 'var(--blue)',
      active: false,
    },
  ];
  return (
    <div className="stat-grid">
      {tiles.map((t) => (
        <div
          key={t.key}
          className={`stat-card ${t.variant}`}
          onClick={t.onClick}
          style={{
            cursor: t.onClick ? 'pointer' : 'default',
            boxShadow: t.active ? `0 0 0 2px ${t.accent}` : undefined,
          }}
        >
          <div className="stat-label">{t.label}</div>
          <div className="stat-val">{t.value}</div>
          {t.sub ? <div className="stat-sub">{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
