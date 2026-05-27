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
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
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

  const columns = useMemo<ColumnDef<NcRegisterListItem>[]>(
    () => [
      {
        header: 'NC No.',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/nc-register/$id"
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
        accessorKey: 'ncDate',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.ncDate}
          </span>
        ),
      },
      {
        header: 'JC No.',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
            {row.original.jcCode ?? '—'}
          </span>
        ),
      },
      {
        header: 'Operation',
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
        header: 'Rej qty',
        cell: ({ row }) => (
          <span className="td-ctr mono fw-700" style={{ color: 'var(--red2)' }}>
            {Number(row.original.rejectedQty).toFixed(0)}
          </span>
        ),
      },
      {
        header: 'Reason',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            {row.original.reasonCategory.replaceAll('_', ' ')}
          </span>
        ),
      },
      {
        header: 'Disposition',
        cell: ({ row }) => <NcDispositionBadge disposition={row.original.disposition} />,
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => <NcStatusBadge status={row.original.status} />,
      },
      {
        header: 'CAPA',
        cell: ({ row }) =>
          row.original.linkedCapaCode ? (
            <Link
              to="/capa"
              className="mono"
              style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700, textDecoration: 'none' }}
              title="Open linked CAPA"
            >
              {row.original.linkedCapaCode}
            </Link>
          ) : (
            <span className="text3" style={{ fontSize: 11 }}>
              —
            </span>
          ),
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
          NC Register
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search NC code, reason, item…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
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
            <option value="">All statuses</option>
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
            <option value="">All reasons</option>
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
          {canWrite ? (
            <Link to="/nc-register/new" className="btn btn-primary">
              <Plus size={14} /> Report NC
            </Link>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatCard label="Total" value={summary?.total} color="var(--red)" />
        <StatCard label="Pending" value={summary?.pending} color="var(--amber)" />
        <StatCard label="Total Qty" value={summary?.totalQty} />
        <StatCard label="Rework" value={summary?.reworkQty} color="var(--cyan)" />
        <StatCard label="Scrap" value={summary?.scrapQty} color="var(--red)" />
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ⚠️ Non-conformance log — QC rejections by JC + op. Dispose on detail page → rework / scrap / use-as-is / return-to-vendor / make-fresh (T-040b cascade).
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
