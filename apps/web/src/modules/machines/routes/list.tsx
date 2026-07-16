// Machine Master list (UI-003-02).
// Ports legacy renderMachines (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13070-13111) to Innovic chrome.
//
// Legacy renders 10 columns: Machine ID | Name | Type | Cap/Shift | ₹/hr |
// Status | Avail Qty | Pending Hrs | 🔧 Maint | Actions. We render 7 — the
// three DELTA columns need data this page's API does not return:
//   • Avail Qty / Pending Hrs — calc-engine machineLoad (legacy L1703-1715).
//     Computed today by the machine-loading module (machineLoadCardSchema:
//     totalAvailQty, pendingHrs) but NOT by GET /machines; wiring a second
//     endpoint in is out of this UI-only pass. See ISSUES ISSUE-018.
//   • 🔧 Maint — legacy derives it from m.lastMaintDate + m.maintCycleDays
//     (L13074-13083); neither column exists in our machines table.
// Legacy's 🔧 Log-Maintenance and Del row actions are likewise DELTA (no
// maint_log table; delete lives on the detail page).
//
// The "Shifts" column previously rendered here is not a legacy column —
// legacy carries shifts on the machine FORM only — so it is dropped and its
// slot returns to legacy's ₹/hr.

import type { ListMachinesQuery, Machine } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type SortingState,
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

  // Header/sort config only — rows are rendered as plain <tr>/<td> below so
  // legacy's cell classes (td-ctr, td-code, mono…) land on the <td> itself.
  // Legacy sTh marks Machine ID / Name / Type / Status sortable (L13107);
  // ₹/hr and Actions are plain <th> there and stay unsortable here.
  const columns = useMemo<ColumnDef<Machine>[]>(
    () => [
      { header: 'Machine ID', accessorKey: 'code' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Type', accessorKey: 'machineType' },
      { header: 'Cap/Shift', accessorKey: 'capacityPerShift' },
      {
        // Legacy: <th style="color:var(--green)">₹/hr</th> (L13107). The colour
        // must be inline on the text — .innovic-table th sets color:var(--text3)
        // and outranks the .green utility class.
        header: () => <span style={{ color: 'var(--green)' }}>₹/hr</span>,
        accessorKey: 'hourRate',
        enableSorting: false,
      },
      { header: 'Status', accessorKey: 'status' },
      { header: 'Actions', enableSorting: false },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data?.machines ?? [],
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
          Machine Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Legacy placeholder is "🔍 Search machine, type…" (L13103) because
              legacy searchFilter (L1513-1520) text-matches the whole rendered
              row, type column included. Our GET /machines only ILIKEs code +
              name (machines/service.ts L38-44), so the legacy wording would
              advertise a search this page cannot do — trimmed per the Vendors
              precedent (ISSUE-018). */}
          <input
            className="innovic-input"
            placeholder="🔍 Search machine…"
            title="Search by machine ID or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ minWidth: 220, fontSize: 13 }}
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
                table.getRowModel().rows.map((row) => {
                  const m = row.original;
                  return (
                    <tr key={row.id}>
                      {/* Legacy machLabel (L1985-1991): code in cyan mono over
                          the machine name in 10px text3. */}
                      <td className="td-code">
                        <Link
                          to="/machines/$id"
                          params={{ id: m.id }}
                          style={{ textDecoration: 'none', lineHeight: 1.3 }}
                        >
                          <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 13 }}>
                            {m.code}
                          </span>
                          <div className="text3" style={{ fontSize: 10, marginTop: 1 }}>
                            {m.name}
                          </div>
                        </Link>
                      </td>
                      <td className="fw-700">{m.name}</td>
                      <td className="text2">{m.machineType ?? '—'}</td>
                      <td className="td-ctr mono">
                        {m.capacityPerShift != null ? `${m.capacityPerShift}h` : '—'}
                      </td>
                      <td className="td-ctr mono green">
                        {m.hourRate ? `₹${m.hourRate.toFixed(0)}` : '—'}
                      </td>
                      <td>
                        <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <Link
                            to="/machines/$id"
                            params={{ id: m.id }}
                            className="btn btn-ghost btn-sm"
                          >
                            View
                          </Link>
                          {canWrite ? (
                            <Link
                              to="/machines/$id/edit"
                              params={{ id: m.id }}
                              className="btn btn-ghost btn-sm"
                            >
                              Edit
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
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
