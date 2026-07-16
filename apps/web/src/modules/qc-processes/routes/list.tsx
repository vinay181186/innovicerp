// QC Process Master list — Phase A item 3. Mirrors legacy renderQCProcessMaster (L23446).
//
// Legacy puts the alignment/format classes on the <td> itself (L23450
// `td-ctr mono fw-700`, L23451 `fw-700`, L23453 `td-ctr mono`) — not on a
// wrapper span. `.td-ctr` is text-align:center (innovic-theme.css:401), which
// is inert on an inline <span>, so those columns rendered left-aligned
// (ISSUE-020). Carry the class through the column def's `meta.tdClass` so the
// flexRender loop can put it where legacy has it. The ColumnMeta augmentation
// lives once, in @/types/tanstack-table.d.ts — do not re-declare it here.

import type { ListQcProcessesQuery, QcProcess } from '@innovic/shared';
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
import { useQcProcessesList, useSoftDeleteQcProcess } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const qcProcessesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes',
  validateSearch: listSearchSchema,
  component: QcProcessesListPage,
});

function QcProcessesListPage(): React.JSX.Element {
  const search = qcProcessesListRoute.useSearch();
  const navigate = qcProcessesListRoute.useNavigate();
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

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

  const query: ListQcProcessesQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useQcProcessesList(query);
  const softDelete = useSoftDeleteQcProcess();

  const columns = useMemo<ColumnDef<QcProcess>[]>(
    () => [
      {
        header: '#',
        enableSorting: false,
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => (search.page - 1) * PAGE_SIZE + row.index + 1,
      },
      {
        header: 'QC Process Name',
        accessorKey: 'code',
        meta: { tdClass: 'fw-700' },
        cell: ({ row }) => (
          <Link
            to="/qc-processes/$id"
            params={{ id: row.original.id }}
            style={{ color: 'var(--green)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Description',
        accessorKey: 'description',
        meta: { tdClass: 'text2' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>{row.original.description ?? '—'}</span>
        ),
      },
      {
        header: 'Std Time (min)',
        id: 'defaultCycleTimeMin',
        accessorFn: (r) => Number(r.defaultCycleTimeMin),
        meta: { tdClass: 'td-ctr mono' },
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>
            {Number(row.original.defaultCycleTimeMin) > 0
              ? Number(row.original.defaultCycleTimeMin).toFixed(2)
              : '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <span className={`badge ${row.original.isActive ? 'b-green' : 'b-amber'}`}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        header: 'Actions',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }}>
            {canWrite ? (
              <Link
                to="/qc-processes/$id/edit"
                params={{ id: row.original.id }}
                className="btn btn-ghost btn-sm"
              >
                Edit
              </Link>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={softDelete.isPending}
                onClick={() => {
                  if (confirm(`Delete QC process "${row.original.code}"?`)) {
                    softDelete.mutate(row.original.id);
                  }
                }}
              >
                Del
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [search.page, canWrite, softDelete],
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
          ⚙ QC Process Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search QC process name, description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 280, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.isActive === undefined ? '' : String(search.isActive)}
            onChange={(e) => {
              const v = e.target.value;
              void navigate({
                search: (prev) => ({
                  ...prev,
                  isActive: v === '' ? undefined : v === 'true',
                  page: 1,
                }),
                replace: true,
              });
            }}
            style={{ width: 130, fontSize: 12 }}
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/qc-processes/new" className="btn btn-primary">
              <Plus size={14} /> Add QC Process
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            💡 Define QC inspection processes here (e.g. Dimensional Check, Hardness Test, CMM
            Inspection). These can be added as <b>QC operations</b> in Route Cards and Job Cards,
            just like machining operations.
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
                  <td
                    colSpan={columns.length}
                    className="empty-state"
                    style={{ color: 'var(--red)' }}
                  >
                    {error instanceof Error ? error.message : 'Failed to load QC processes'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No QC processes defined. Click + Add QC Process.
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
            ? 'No QC processes'
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
