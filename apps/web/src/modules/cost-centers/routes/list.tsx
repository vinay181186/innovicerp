// Cost Center Master list — Phase A item 4. Mirrors legacy renderCostCenters L17165.

import {
  COST_CENTER_DEPARTMENTS,
  COST_CENTER_TYPES,
  type CostCenter,
  type ListCostCentersQuery,
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
import { useCostCentersList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  department: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const costCentersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers',
  validateSearch: listSearchSchema,
  component: CostCentersListPage,
});

function CostCentersListPage(): React.JSX.Element {
  const search = costCentersListRoute.useSearch();
  const navigate = costCentersListRoute.useNavigate();
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

  const query: ListCostCentersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      department: search.department,
      type: search.type,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.department, search.type, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useCostCentersList(query);

  const columns = useMemo<ColumnDef<CostCenter>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/cost-centers/$id"
            params={{ id: row.original.id }}
            className="td-code fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ row }) => <span className="fw-700">{row.original.name}</span>,
      },
      {
        header: 'Department',
        accessorKey: 'department',
        cell: ({ row }) => (
          <span style={{ fontSize: 11 }}>{row.original.department ?? '—'}</span>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.type ?? '—'}</span>,
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11 }}>
            {row.original.description ?? '—'}
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
          🏢 Cost Center Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, name, description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.department ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  department: e.target.value === '' ? undefined : e.target.value,
                  page: 1,
                }),
                replace: true,
              })
            }
            style={{ width: 130, fontSize: 12 }}
          >
            <option value="">All departments</option>
            {COST_CENTER_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="innovic-select"
            value={search.type ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  type: e.target.value === '' ? undefined : e.target.value,
                  page: 1,
                }),
                replace: true,
              })
            }
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All types</option>
            {COST_CENTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
            style={{ width: 110, fontSize: 12 }}
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
            <Link to="/cost-centers/new" className="btn btn-primary">
              <Plus size={14} /> Add Cost Center
            </Link>
          ) : null}
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
                    {error instanceof Error ? error.message : 'Failed to load cost centers'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No cost centers. Click + Add Cost Center.
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
            ? 'No cost centers'
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
