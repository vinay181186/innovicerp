// TPI Master list — the third-party inspectors the TPI screen's Inspector field
// now picks from. Mirrors the QC Process Master list (its sibling in the Quality
// → Master menu), with one deliberate difference: this is a master, so it
// scrolls in ONE fetch instead of paging (styling skill, rule 4). 200 is the
// cap listTpiMastersQuerySchema allows, and an inspector list is tens of rows.
//
// `code` holds the inspector's NAME, so the column reads "Inspector Name" — see
// packages/shared/src/schemas/tpi-master.ts.

import type { ListTpiMastersQuery, TpiMaster } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SortableHead } from '@/components/shared/sortable-head';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoftDeleteTpiMaster, useTpiMastersList } from '../api';

const LIST_LIMIT = 200;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const tpiMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters',
  validateSearch: listSearchSchema,
  component: TpiMastersListPage,
});

function TpiMastersListPage(): React.JSX.Element {
  const search = tpiMastersListRoute.useSearch();
  const navigate = tpiMastersListRoute.useNavigate();
  // Tier-driven, per department (QC) — same gate shape as QC Process Master.
  // Add is `entry`, Edit is `edit`, Del is the L5-and-above pair below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve.
  const canDelete = perms.edit && perms.approve;

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

  const query: ListTpiMastersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.isActive],
  );

  const { data, isLoading, isFetching, isError, error } = useTpiMastersList(query);
  const softDelete = useSoftDeleteTpiMaster();

  const columns = useMemo<ColumnDef<TpiMaster>[]>(
    () => [
      {
        header: '#',
        enableSorting: false,
        meta: { tdClass: 'td-ctr mono fw-700' },
        cell: ({ row }) => row.index + 1,
      },
      {
        header: 'Inspector Name',
        accessorKey: 'code',
        meta: { tdClass: 'fw-700' },
        cell: ({ row }) => (
          <Link
            to="/tpi-masters/$id"
            params={{ id: row.original.id }}
            style={{ color: 'var(--green)', textDecoration: 'none' }}
          >
            {row.original.code}
          </Link>
        ),
      },
      {
        header: 'Organization',
        accessorKey: 'organization',
        meta: { tdClass: 'text2' },
        // Free text that runs long — clip with an ellipsis and keep the whole
        // value on hover, rather than letting one firm name widen the table.
        cell: ({ row }) => (
          <span
            style={{
              fontSize: 11,
              maxWidth: 220,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
            }}
            title={row.original.organization ?? ''}
          >
            {row.original.organization ?? '—'}
          </span>
        ),
      },
      {
        header: 'Contact No.',
        accessorKey: 'contactNo',
        meta: { tdClass: 'mono' },
        cell: ({ row }) => <span style={{ fontSize: 11 }}>{row.original.contactNo ?? '—'}</span>,
      },
      {
        header: 'Email',
        accessorKey: 'email',
        meta: { tdClass: 'text2' },
        cell: ({ row }) => (
          <span
            style={{
              fontSize: 11,
              maxWidth: 200,
              display: 'inline-block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              verticalAlign: 'bottom',
            }}
            title={row.original.email ?? ''}
          >
            {row.original.email ?? '—'}
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
        // The row itself opens the detail page, so these two — which do
        // something else — stop the click on their wrapper.
        cell: ({ row }) => (
          <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
            {perms.edit ? (
              <Link
                to="/tpi-masters/$id/edit"
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
                  if (confirm(`Delete inspector "${row.original.code}"?`)) {
                    // Reset first so a second attempt clears the previous banner.
                    softDelete.reset();
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
    [perms.edit, canDelete, softDelete],
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Sits after every hook (incl.
  // useReactTable) so the early return never trips rules-of-hooks.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const total = data?.total ?? 0;

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
          🔍 TPI Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search inspector name, organization…"
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
                search: (prev) => ({ ...prev, isActive: v === '' ? undefined : v === 'true' }),
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
          {perms.entry ? (
            <Link to="/tpi-masters/new" className="btn btn-primary">
              <Plus size={14} /> Add Inspector
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            💡 Add third-party inspectors here. The <b>Inspector Name</b> field on the TPI screen
            picks from this list, and picking a name fills in their organization.
          </span>
        </div>
      </div>

      {/* Why a banner and not a toast: the delete may be refused for a reason
          the user has to act on (retire the inspector as Inactive instead). It
          stays on screen until the next attempt. */}
      {softDelete.error ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div
            className="panel-body"
            style={{
              padding: '10px 14px',
              background: 'var(--red3)',
              color: 'var(--red)',
              fontSize: 12,
            }}
            role="alert"
          >
            ⚠ {softDelete.error.message}
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
                    {error instanceof Error ? error.message : 'Failed to load TPI inspectors'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No inspectors defined. Click + Add Inspector.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() =>
                      void navigate({ to: '/tpi-masters/$id', params: { id: row.original.id } })
                    }
                    style={{ cursor: 'pointer' }}
                  >
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

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        {total === 0
          ? 'No inspectors'
          : total > LIST_LIMIT
            ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
            : `Showing all ${total} inspector${total === 1 ? '' : 's'}`}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
        💡 Click a row to open it.
      </div>
    </div>
  );
}
