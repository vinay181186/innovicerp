// Client Master list (UI-003-02).
// Ports legacy renderClients (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L12969-12995) to Innovic chrome. Legacy columns, in order:
// Code | Client Name | Address | Contact | Email | <blank actions th> (L12991).
// Status is a port-only column: legacy clients have no status field, ours carry
// isActive and the API filters on it (see ISSUES.md logged delta).
//
// Styled to the shared list standard (see .claude/skills/styling + the SO Master
// reference apps/web/src/modules/sales-orders/routes/list.tsx):
//   • one frozen header band, so the title + StatStrip + toolbar stay put while
//     the rows scroll under them;
//   • counts sit in ONE <StatStrip> (All / Active / Inactive) — real numbers
//     computed from the loaded rows, doubling as the status filter (Rule 3);
//   • whole rows are clickable to the detail page, actions stop propagation
//     (Rule 2);
//   • one scrolling fetch, no Prev/Next — the master-list conversion Rule 4
//     names for Clients (status filter + counts are done client-side over the
//     single fetch, which is why the server query drops isActive).

import type { Client, ListClientsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { SortTh, nextSort } from '@/components/shared/sortable-th';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useClientsList, useCreateClient, useSoftDeleteClient } from '../api';
import { downloadClientTemplate, parseClientImportFile } from '../lib/import-export';

// No pagination — Clients is a master list, so it mirrors the SO/WO list: one
// fetch, everything in a single scrolling list (styling skill, Rule 4). The
// clients list endpoint caps `limit` at 1000 (packages/shared client schema,
// raised from 200 to match the SO master); the count line flags a larger set.
const LIST_LIMIT = 1000;

// Join a list of import warnings/failures for the status line, capping at 50 so
// a huge sheet can't produce an unbounded banner, but still showing far more
// than the old 3-item cap that hid most problems.
function fmtList(items: string[]): string {
  const shown = items.slice(0, 50).join('; ');
  return items.length > 50 ? `${shown} … (+${items.length - 50} more)` : shown;
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['code', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const clientsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients',
  validateSearch: listSearchSchema,
  component: ClientsListPage,
});

function ClientsListPage(): React.JSX.Element {
  const search = clientsListRoute.useSearch();
  const navigate = clientsListRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // One fetch of every client matching the search (no isActive server filter):
  // the Active/Inactive split is derived + filtered client-side so the StatStrip
  // can show real counts for all three tiles.
  const query: ListClientsQuery = useMemo(
    () => ({
      search: search.search,
      sortBy: search.sortBy,
      sortDir: search.sortDir,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.sortBy, search.sortDir],
  );

  const { data, isLoading, isFetching, isError, error } = useClientsList(query);
  const softDelete = useSoftDeleteClient();
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // Excel import — parse the workbook, then create each client sequentially
  // (each success invalidates the list via the mutation hook).
  const createClient = useCreateClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseClientImportFile(file);
      // Re-import guard: the template has no Code column, so the same file would
      // otherwise create duplicate clients on every import. Skip any name that
      // already exists (case-insensitive) in the loaded list.
      const existingNames = new Set((data?.clients ?? []).map((c) => c.name.trim().toLowerCase()));
      const warnings = [...errors];
      let ok = 0;
      let skipped = 0;
      const fails: string[] = [];
      for (const p of payloads) {
        const key = p.name.trim().toLowerCase();
        if (existingNames.has(key)) {
          skipped += 1;
          warnings.push(`"${p.name}" already exists — skipped`);
          continue;
        }
        existingNames.add(key);
        try {
          await createClient.mutateAsync(p);
          ok += 1;
        } catch (e) {
          fails.push(`${p.name}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setImportMsg(
        `Imported ${ok}/${payloads.length} client(s).` +
          (skipped ? ` ${skipped} duplicate(s) skipped.` : '') +
          (warnings.length ? ` ${warnings.length} row warning(s): ${fmtList(warnings)}` : '') +
          (fails.length ? ` Failures: ${fmtList(fails)}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const toggleSort = useCallback(
    (field: 'code' | 'name') => {
      const next = nextSort(field, { sortBy: search.sortBy, sortDir: search.sortDir });
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
    },
    [navigate, search.sortBy, search.sortDir],
  );

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status }), replace: true });
    },
    [navigate],
  );

  const columns = useMemo<ColumnDef<Client>[]>(
    () => [
      {
        header: () => (
          <SortTh
            label="Code"
            field="code"
            sortBy={search.sortBy}
            sortDir={search.sortDir}
            onSort={toggleSort}
          />
        ),
        accessorKey: 'code',
        cell: ({ row }) => (
          <Link
            to="/clients/$id"
            params={{ id: row.original.id }}
            className="td-code"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: () => (
          <SortTh
            label="Client Name"
            field="name"
            sortBy={search.sortBy}
            sortDir={search.sortDir}
            onSort={toggleSort}
          />
        ),
        accessorKey: 'name',
        cell: ({ row }) => <span className="fw-700">{row.original.name}</span>,
      },
      {
        id: 'address',
        header: 'Address',
        // Long free text — clip with ellipsis + full value on hover (Rule 1),
        // rather than forcing it onto one unbounded line.
        cell: ({ row }) => (
          <span
            className="text2"
            style={{
              fontSize: 11,
              maxWidth: 180,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={row.original.addressLine1 ?? ''}
          >
            {row.original.addressLine1 ?? '—'}
          </span>
        ),
      },
      {
        header: 'Contact',
        accessorKey: 'contactPerson',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.contactPerson ?? '—'}
          </span>
        ),
      },
      {
        header: 'Email',
        accessorKey: 'email',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.email ?? '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <span className={`badge ${row.original.isActive ? 'b-green' : 'b-grey'}`}>
            {row.original.isActive ? 'active' : 'inactive'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        // Edit/Del go somewhere OTHER than the row's detail page, so they stop
        // the row-navigation click (Rule 2).
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {canEdit ? (
              <Link
                to="/clients/$id/edit"
                params={{ id: row.original.id }}
                className="btn btn-ghost btn-sm"
              >
                Edit
              </Link>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={softDelete.isPending}
                onClick={() => {
                  if (confirm(`Move client ${row.original.name} to Trash?`)) {
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
    [canEdit, canDelete, softDelete, search.sortBy, search.sortDir, toggleSort],
  );

  // All rows matching the search; the Active/Inactive filter is client-side.
  const allRows = useMemo(() => data?.clients ?? [], [data?.clients]);
  const activeCount = useMemo(() => allRows.filter((c) => c.isActive).length, [allRows]);
  const inactiveCount = allRows.length - activeCount;
  const visibleRows = useMemo(() => {
    if (search.status === 'active') return allRows.filter((c) => c.isActive);
    if (search.status === 'inactive') return allRows.filter((c) => !c.isActive);
    return allRows;
  }, [allRows, search.status]);

  const table = useReactTable({
    data: visibleRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Frozen header band — title, toolbar and the StatStrip stay put while the
          rows scroll underneath (mirrors the SO Master list). Opaque `--bg`
          background so rows don't show through as they pass under it. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Client Master
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="🔍 Search client, code…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 200, fontSize: 12 }}
            />
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/clients/new" className="btn btn-primary">
                <Plus size={14} /> New Client
              </Link>
            ) : null}
          </div>
        </div>

        {/* Counts double as the status filter (Rule 3). Active state = coloured
            label + underline, handled inside <StatStrip>. */}
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Clients',
              count: total,
              color: 'var(--cyan)',
              active: search.status === undefined,
              onClick: () => setStatus(undefined),
            },
            {
              key: 'active',
              label: 'Active',
              count: activeCount,
              color: 'var(--green)',
              active: search.status === 'active',
              onClick: () => setStatus('active'),
            },
            {
              key: 'inactive',
              label: 'Inactive',
              count: inactiveCount,
              color: 'var(--text3)',
              active: search.status === 'inactive',
              onClick: () => setStatus('inactive'),
            },
          ]}
        />
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
                    {error instanceof Error ? error.message : 'Failed to load clients'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    {search.status
                      ? `No ${search.status} clients`
                      : 'No clients yet — click + New Client'}
                  </td>
                </tr>
              ) : (
                // Whole row navigates to the client's detail page (Rule 2).
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() =>
                      void navigate({ to: '/clients/$id', params: { id: row.original.id } })
                    }
                    style={{ cursor: 'pointer' }}
                  >
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
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No clients'
            : search.status
              ? `Showing ${visibleRows.length} ${search.status} of ${total} client${total === 1 ? '' : 's'}`
              : total > LIST_LIMIT
                ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
                : `Showing all ${total} client${total === 1 ? '' : 's'}`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the client. Click a count above to filter by status.
      </div>

      {/* Excel template + import sit below the table panel (mirror of Vendor Master). */}
      {canAdd ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => downloadClientTemplate()}
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
            accept=".xlsx,.xls,.csv"
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
