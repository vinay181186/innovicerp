// Vendor Master list (UI-003-02; parity pass 2026-06-11).
// Ports legacy renderVendors (legacy/InnovicERP_v82_12_3.html L27734) to
// Innovic chrome. Columns: Code | Name | Contact | Phone | Email | GST No.
// | Address | Materials | Rating | Status | Actions. Materials is our
// addition; Address restored to match legacy. The legacy "Rating" column has
// auto-computed grade (A/B/C/D); we render whatever the rating string
// holds (the auto-computation + PO/GRN count column remain a backend cascade
// not yet shipped — DELTA backlog). Excel Template + Import and a per-row
// Del→Trash button added in this pass.

import type { ListVendorsQuery, Vendor } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateVendor, useSoftDeleteVendor, useVendorsList } from '../api';
import { downloadVendorTemplate, parseVendorImportFile } from '../lib/import-export';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const vendorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors',
  validateSearch: listSearchSchema,
  component: VendorsListPage,
});

function ratingBadgeClass(rating: string | null): string {
  if (!rating) return 'b-grey';
  const g = rating.trim().toUpperCase()[0];
  if (g === 'A') return 'b-green';
  if (g === 'B') return 'b-blue';
  if (g === 'C') return 'b-amber';
  if (g === 'D') return 'b-red';
  return 'b-grey';
}

function VendorsListPage(): React.JSX.Element {
  const search = vendorsListRoute.useSearch();
  const navigate = vendorsListRoute.useNavigate();
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

  const query: ListVendorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useVendorsList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const softDelete = useSoftDeleteVendor();

  // Excel import — parse the workbook, then create each vendor sequentially
  // (each success invalidates the list via the mutation hook).
  const createVendor = useCreateVendor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseVendorImportFile(file);
      let ok = 0;
      const fails: string[] = [];
      for (const p of payloads) {
        try {
          await createVendor.mutateAsync(p);
          ok += 1;
        } catch (e) {
          fails.push(`${p.code}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setImportMsg(
        `Imported ${ok}/${payloads.length} vendor(s).` +
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

  const columns = useMemo<ColumnDef<Vendor>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/vendors/$id"
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
        header: 'Contact',
        cell: ({ row }) => (
          <span style={{ fontSize: 12 }}>{row.original.contactPerson ?? '—'}</span>
        ),
      },
      {
        header: 'Phone',
        cell: ({ row }) => <span style={{ fontSize: 12 }}>{row.original.phone ?? '—'}</span>,
      },
      {
        header: 'Email',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11 }}>
            {row.original.email ?? '—'}
          </span>
        ),
      },
      {
        header: 'GST No.',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11 }}>
            {row.original.gstNumber ?? '—'}
          </span>
        ),
      },
      {
        header: 'Address',
        cell: ({ row }) => (
          <span
            className="text3"
            style={{
              fontSize: 11,
              maxWidth: 150,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={row.original.addressLine1 ?? undefined}
          >
            {row.original.addressLine1 ?? '—'}
          </span>
        ),
      },
      {
        header: 'Materials',
        cell: ({ row }) => (
          <span className="text3" style={{ fontSize: 11 }}>
            {row.original.materialsSupplied ?? '—'}
          </span>
        ),
      },
      {
        header: 'Rating',
        cell: ({ row }) => (
          <span className={`badge ${ratingBadgeClass(row.original.rating)}`}>
            ⭐ {row.original.rating ?? '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <span className={`badge ${row.original.isActive ? 'b-green' : 'b-red'}`}>
            {row.original.isActive ? 'active' : 'inactive'}
          </span>
        ),
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }}>
            <Link
              to="/vendors/$id"
              params={{ id: row.original.id }}
              className="btn btn-ghost btn-sm"
            >
              View
            </Link>
            {canWrite ? (
              <Link
                to="/vendors/$id/edit"
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
                  if (confirm(`Move vendor ${row.original.code} — ${row.original.name} to Trash?`)) {
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
    [canWrite, softDelete],
  );

  const table = useReactTable({
    data: data?.vendors ?? [],
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
          🏭 Vendor Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search vendor, material…"
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
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                title="Download Excel template"
                onClick={() => downloadVendorTemplate()}
              >
                ⬇ Template
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                disabled={importing}
                onClick={() => fileRef.current?.click()}
              >
                {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '📄'} Import Excel
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
              <Link to="/vendors/new" className="btn btn-primary">
                <Plus size={14} /> Add Vendor
              </Link>
            </>
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
                    {error instanceof Error ? error.message : 'Failed to load vendors'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No vendors. Add vendors to create Purchase Orders.
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
            ? 'No vendors'
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
