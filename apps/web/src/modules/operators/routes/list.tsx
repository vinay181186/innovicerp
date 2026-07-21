// Operator Master list (UI-003-02).
// Ports legacy renderOperators (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13699-13725) to Innovic chrome. Legacy columns, in order (L13721):
// Operator ID | Name | Department | Skills / Machines | Status | Actions.
// Legacy row cells (L13702-13710) carry .td-code / .fw-700 / .text2 on the <td>
// itself, so rows render as plain <tr>/<td> markup; TanStack Table is kept for
// the column defs + client-side sort that drives <SortableHead>.
// Legacy sorts Operator ID / Name / Department / Status only (sTh, L13721) —
// Skills / Machines and Actions are plain <th>.

import type { ListOperatorsQuery, Operator } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateOperator, useOperatorsList, useSoftDeleteOperator } from '../api';
import { downloadOperatorTemplate, parseOperatorImportFile } from '../lib/import-export';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const operatorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators',
  validateSearch: listSearchSchema,
  component: OperatorsListPage,
});

function OperatorsListPage(): React.JSX.Element {
  const search = operatorsListRoute.useSearch();
  const navigate = operatorsListRoute.useNavigate();
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

  const isActiveFilter =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;

  const query: ListOperatorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useOperatorsList(query);
  const softDelete = useSoftDeleteOperator();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  // Excel import — parse the workbook, then create each operator sequentially
  // (each success invalidates the list via the mutation hook).
  const createOperator = useCreateOperator();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseOperatorImportFile(file);
      let ok = 0;
      const fails: string[] = [];
      for (const p of payloads) {
        try {
          await createOperator.mutateAsync(p);
          ok += 1;
        } catch (e) {
          fails.push(`${p.name}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setImportMsg(
        `Imported ${ok}/${payloads.length} operator(s).` +
          (errors.length ? ` ${errors.length} row warning(s): ${errors.slice(0, 3).join('; ')}` : '') +
          (fails.length ? ` Failures: ${fails.slice(0, 3).join('; ')}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // Headers + sort accessors only — cells render as plain <td> below so legacy's
  // per-cell classes land on the <td>, matching L13702-13710.
  const columns = useMemo<ColumnDef<Operator>[]>(
    () => [
      { header: 'Operator ID', accessorKey: 'code' },
      { header: 'Name', accessorKey: 'name' },
      { header: 'Department', accessorKey: 'department' },
      // Legacy L13721 renders a plain <th> here — not an sTh — so no sort.
      { header: 'Skills / Machines', accessorKey: 'skills', enableSorting: false },
      { header: 'Status', accessorKey: 'isActive' },
      { header: 'Actions', enableSorting: false },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data: data?.operators ?? [],
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
          Operator Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search name, department…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as 'active' | 'inactive' | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 120, fontSize: 12 }}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/operators/new" className="btn btn-primary">
              <Plus size={14} /> Add Operator
            </Link>
          ) : null}
        </div>
      </div>

      {importMsg ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12 }}>
            {importMsg}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 10 }}
              onClick={() => setImportMsg(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

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
                    {error instanceof Error ? error.message : 'Failed to load operators'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No operators — click <strong>+ Add Operator</strong> to begin
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => {
                  const op = row.original;
                  return (
                    <tr key={row.id}>
                      <td className="td-code" style={{ color: 'var(--cyan)' }}>
                        <Link
                          to="/operators/$id"
                          params={{ id: op.id }}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {op.code}
                        </Link>
                      </td>
                      <td className="fw-700">{op.name}</td>
                      <td className="text2">{op.department ?? '—'}</td>
                      <td className="text2" style={{ fontSize: 12 }}>
                        {op.skills ?? '—'}
                      </td>
                      <td>
                        <span className={`badge ${op.isActive ? 'b-green' : 'b-grey'}`}>
                          {op.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {canWrite ? (
                            <Link
                              to="/operators/$id/edit"
                              params={{ id: op.id }}
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
                                if (confirm(`Move operator "${op.name}" to Trash?`)) {
                                  softDelete.mutate(op.id);
                                }
                              }}
                            >
                              Del
                            </button>
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
            ? 'No operators'
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

      {/* Excel template + import sit below the table panel (mirror of Vendors). */}
      {canWrite ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => downloadOperatorTemplate()}
          >
            ⬇ Download Excel Template
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '📄'} Import from
            Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
