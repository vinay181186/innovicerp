// Machine Master list (UI-003-02).
// Ports legacy renderMachines (legacy/InnovicERP_v82_12_3.html L13070) to
// Innovic chrome. Legacy has 10 columns including calc-engine fields
// (Avail Qty, Pending Hrs, Maint Status) that aren't in the current
// shared Machine type — we show the columns we have: Machine ID | Name
// | Type | Cap/Shift | Shifts | Status | Actions. The calc-engine
// columns are deferred until a backend cascade computes them.

import type { ListMachinesQuery, Machine } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachinesList } from '../api';

const PAGE_SIZE = 25;
const STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const machinesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines',
  validateSearch: listSearchSchema,
  component: MachinesListPage,
});

function statusBadgeClass(status: string): string {
  if (status === 'Running') return 'b-blue';
  if (status === 'Idle') return 'b-grey';
  if (status === 'Maintenance') return 'b-amber';
  if (status === 'Down') return 'b-red';
  return 'b-grey';
}

function MachinesListPage(): React.JSX.Element {
  const search = machinesListRoute.useSearch();
  const navigate = machinesListRoute.useNavigate();
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

  const query: ListMachinesQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useMachinesList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const columns = useMemo<ColumnDef<Machine>[]>(
    () => [
      {
        header: 'Machine ID',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/machines/$id"
            params={{ id: row.original.id }}
            className="td-code"
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
        header: 'Type',
        accessorKey: 'machineType',
        cell: ({ row }) => (
          <span className="text2">{row.original.machineType ?? '—'}</span>
        ),
      },
      {
        header: 'Cap / Shift',
        cell: ({ row }) => (
          <span className="mono td-ctr">
            {row.original.capacityPerShift != null ? `${row.original.capacityPerShift}h` : '—'}
          </span>
        ),
      },
      {
        header: 'Shifts',
        cell: ({ row }) => (
          <span className="mono td-ctr">{row.original.shiftsPerDay ?? '—'}</span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ row }) => (
          <span className={`badge ${statusBadgeClass(row.original.status)}`}>
            {row.original.status}
          </span>
        ),
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }}>
            <Link
              to="/machines/$id"
              params={{ id: row.original.id }}
              className="btn btn-ghost btn-sm"
            >
              View
            </Link>
            {canWrite ? (
              <Link
                to="/machines/$id/edit"
                params={{ id: row.original.id }}
                className="btn btn-ghost btn-sm"
              >
                Edit
              </Link>
            ) : null}
          </div>
        ),
      },
    ],
    [canWrite],
  );

  const table = useReactTable({
    data: data?.machines ?? [],
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
          Machine Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search machine, type…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as (typeof STATUSES)[number] | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
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
            <Link to="/machines/new" className="btn btn-primary">
              <Plus size={14} /> Add Machine
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
                    {error instanceof Error ? error.message : 'Failed to load machines'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No machines
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
            ? 'No machines'
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
