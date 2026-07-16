// NC register list (UI-003-06).

import {
  type ListNcRegisterQuery,
  NC_REASON_CATEGORIES,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  NC_STATUSES,
  type NcReasonCategory,
  type NcRegisterListItem,
  type NcStatus,
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
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useNcRegisterList, useNcRegisterSummary } from '../api';
import { NcDispositionBadge } from '../components/nc-disposition-badge';
import { NcStatusBadge } from '../components/nc-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(NC_STATUSES).optional(),
  reasonCategory: z.enum(NC_REASON_CATEGORIES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const ncRegisterListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register',
  validateSearch: listSearchSchema,
  component: NcRegisterListPage,
});

function NcRegisterListPage(): React.JSX.Element {
  const search = ncRegisterListRoute.useSearch();
  const navigate = ncRegisterListRoute.useNavigate();
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

  const query: ListNcRegisterQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      reasonCategory: search.reasonCategory,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.reasonCategory, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useNcRegisterList(query);
  const { data: summary } = useNcRegisterSummary();
  const canWrite = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'operator';
  // CAPA create is admin/manager/qc (matches capa_records RLS + detail.tsx).
  const canCapa = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';

  const columns = useMemo<ColumnDef<NcRegisterListItem>[]>(
    () => [
      {
        // Legacy L22526: <td class="mono fw-700" style="color:var(--red)">.
        // The cell classes belong on the <td> (ISSUE-020) — carried by
        // meta.tdClass. The link is the port's stand-in for legacy's 👁 _viewNC
        // modal, which is also offered in Actions below.
        header: 'Rej No.',
        accessorKey: 'code',
        meta: { tdClass: 'mono fw-700' },
        cell: ({ row }) => (
          <Link
            to="/nc-register/$id"
            params={{ id: row.original.id }}
            style={{ color: 'var(--red)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Date',
        accessorKey: 'ncDate',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.ncDate}</span>,
      },
      {
        header: 'JC No.',
        accessorKey: 'jcCode',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
            {row.original.jcCode ?? '—'}
          </span>
        ),
      },
      {
        header: 'Operation',
        id: 'operation',
        accessorFn: (r) => r.jcOpSeqResolved ?? r.opSeq ?? 0,
        cell: ({ row }) => {
          const seq = row.original.jcOpSeqResolved ?? row.original.opSeq;
          const op =
            row.original.jcOpOperation ??
            row.original.operationText ??
            row.original.qcOperationText;
          if (seq == null && !op) return <span className="text3" style={{ fontSize: 11 }}>—</span>;
          return (
            <span style={{ fontSize: 11 }}>
              {seq != null ? `Op${seq}` : ''}
              {seq != null && op ? ': ' : ''}
              {op ?? ''}
            </span>
          );
        },
      },
      {
        header: 'Item',
        id: 'item',
        accessorFn: (r) => r.itemCode ?? r.itemCodeText ?? '',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            <span className="mono">{row.original.itemCode ?? row.original.itemCodeText}</span>
            <span className="text3" style={{ marginLeft: 6 }}>
              {row.original.itemName ?? row.original.itemNameText ?? ''}
            </span>
          </span>
        ),
      },
      {
        // Legacy L22531 puts `td-ctr mono fw-700` on the <td> and colours it
        // var(--red); `.td-ctr` is text-align, so it only works from the <td>
        // (ISSUE-020). Header itself is red in legacy (L22559).
        header: () => <span style={{ color: 'var(--red)' }}>Qty</span>,
        id: 'rejectedQty',
        accessorFn: (r) => Number(r.rejectedQty),
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => (
          <span style={{ color: 'var(--red)' }}>
            {Number(row.original.rejectedQty).toFixed(0)}
          </span>
        ),
      },
      {
        header: 'Reason',
        accessorKey: 'reasonCategory',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            {NC_REASON_CATEGORY_LABELS[row.original.reasonCategory]}
          </span>
        ),
      },
      {
        header: 'Disposition',
        accessorKey: 'disposition',
        cell: ({ row }) => (
          <>
            <NcDispositionBadge disposition={row.original.disposition} />
            {/* Legacy L22534: rework progress hint beside the disposition. */}
            {row.original.disposition === 'rework' && Number(row.original.reworkDoneQty) > 0 ? (
              <span style={{ fontSize: 9, color: 'var(--cyan)', marginLeft: 4 }}>
                ♻ {Number(row.original.reworkDoneQty)}/{Number(row.original.rejectedQty)} done
              </span>
            ) : null}
          </>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <NcStatusBadge status={row.original.status} />,
      },
      {
        // Legacy L22537-22545. The port's dispose / close-rework / create-CAPA
        // writes live on the NC detail page (they need the disposition panel and
        // the rework-qty input), so these link there instead of opening legacy's
        // in-list modal. The linked-CAPA jump and 👤+ assign behave as legacy.
        header: 'Actions',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <Link
                to="/nc-register/$id"
                params={{ id: r.id }}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10 }}
                title="View NC"
              >
                👁
              </Link>
              {canWrite && r.status === 'pending' ? (
                <Link
                  to="/nc-register/$id"
                  params={{ id: r.id }}
                  className="btn btn-primary btn-sm"
                  style={{ fontSize: 10 }}
                  title="Dispose this NC on its detail page"
                >
                  ✏ Dispose
                </Link>
              ) : null}
              {canWrite && r.status === 'disposed' && r.disposition === 'rework' ? (
                <Link
                  to="/nc-register/$id"
                  params={{ id: r.id }}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10 }}
                  title="Close the rework on this NC's detail page"
                >
                  ✅ Close
                </Link>
              ) : null}
              {canCapa && r.status !== 'pending' && !r.linkedCapaCode ? (
                <Link
                  to="/nc-register/$id"
                  params={{ id: r.id }}
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 10, color: 'var(--purple)' }}
                  title="Create a CAPA from this NC on its detail page"
                >
                  🛡 CAPA
                </Link>
              ) : null}
              {r.linkedCapaCode ? (
                <Link
                  to="/capa"
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--purple)',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                  title="Open linked CAPA"
                >
                  {r.linkedCapaCode}
                </Link>
              ) : null}
              {r.status !== 'closed' ? (
                <AssignTaskButton
                  linkedRef={{
                    type: 'nc',
                    id: r.id,
                    display: `NC ${r.code}`,
                    navPage: `/nc-register/${r.id}`,
                  }}
                  suggestedTitle={
                    r.status === 'pending' ? `Dispose ${r.code}` : `Review ${r.code}`
                  }
                  className="btn btn-ghost btn-sm"
                  label=""
                />
              ) : null}
            </div>
          );
        },
      },
    ],
    [canWrite, canCapa],
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
      {/* Legacy L22549-22551: title + Report NC only; filters sit below the
          cards in their own row. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          ❌ NC Register
        </div>
        {canWrite ? (
          <Link to="/nc-register/new" className="btn btn-primary">
            ❌ Report NC
          </Link>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total" value={summary?.total} color="var(--red)" />
        <StatCard label="Pending" value={summary?.pending} color="var(--amber)" />
        <StatCard label="Total Qty" value={summary?.totalQty} />
        <StatCard label="Rework" value={summary?.reworkQty} color="var(--cyan)" />
        <StatCard label="Scrap" value={summary?.scrapQty} color="var(--red)" />
      </div>

      {/* Legacy L22553-22557 filter row. Placeholder names only the fields the
          API actually searches — legacy's "Search JC, item, reason..." works
          because its filter is a client-side row-text scan; the port's search
          is server-side over code/reason/item (service.ts L215) and does NOT
          match JC. */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <input
          className="innovic-input"
          placeholder="🔍 Search NC code, item, reason…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ minWidth: 220, fontSize: 13 }}
        />
        <select
          className="innovic-select"
          value={search.status ?? ''}
          onChange={(e) => {
            const v = e.target.value as NcStatus | '';
            void navigate({
              search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
              replace: true,
            });
          }}
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">All Status</option>
          {NC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {NC_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          className="innovic-select"
          value={search.reasonCategory ?? ''}
          onChange={(e) => {
            const v = e.target.value as NcReasonCategory | '';
            void navigate({
              search: (prev) => ({
                ...prev,
                reasonCategory: v === '' ? undefined : v,
                page: 1,
              }),
              replace: true,
            });
          }}
          style={{ width: 160, fontSize: 12 }}
        >
          <option value="">All Reasons</option>
          {NC_REASON_CATEGORIES.map((r) => (
            <option key={r} value={r}>
              {NC_REASON_CATEGORY_LABELS[r]}
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
                  <td colSpan={columns.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load NCs'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No NCs recorded. NCs are auto-created when QC rejects parts.
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

      {/* Legacy L22561 tip line. */}
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        💡 NCs are auto-created from QC Call Register. Click <b>✏ Dispose</b> to decide: Rework,
        Scrap, Use As Is, Return to Vendor, or Make Fresh.
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
            ? 'No NCs'
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

// Company-wide stat card (legacy HTML L22508-22519). `value` undefined while
// the summary query is loading → shows a dash.
function StatCard(props: {
  label: string;
  value: number | undefined;
  color?: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{props.label}</div>
      <div
        className="mono fw-700"
        style={{ fontSize: 22, color: props.color ?? 'var(--text)' }}
      >
        {props.value == null ? '—' : Math.round(props.value)}
      </div>
    </div>
  );
}
