// User Management list — Phase A item 5a. Mirrors legacy renderUsers L13435.
// Admin-only. Insert is intentionally absent (Supabase Auth owns invites).

import { USER_ROLES, type ListUsersQuery, type User, type UserRole } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2, Pencil } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useApprovalConfig } from '@/modules/approval-config/api';
import { useUsersList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const usersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'users',
  validateSearch: listSearchSchema,
  component: UsersListPage,
});

function roleBadgeClass(role: UserRole): string {
  if (role === 'admin') return 'b-red';
  if (role === 'manager') return 'b-blue';
  if (role === 'operator') return 'b-amber';
  if (role === 'qc') return 'b-cyan';
  return 'b-grey';
}

function UsersListPage(): React.JSX.Element {
  const search = usersListRoute.useSearch();
  const navigate = usersListRoute.useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';

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

  const query: ListUsersQuery = useMemo(
    () => ({
      search: search.search,
      role: search.role,
      isActive: search.isActive,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.role, search.isActive, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useUsersList(query, {
    enabled: isAdmin,
  });
  const { data: approvalCfg } = useApprovalConfig();
  const approverSet = useMemo(
    () => new Set(approvalCfg?.poApprovers ?? []),
    [approvalCfg],
  );

  const columns = useMemo<ColumnDef<User>[]>(
    () => [
      {
        header: 'Name',
        cell: ({ row }) => (
          <Link
            to="/users/$id/edit"
            params={{ id: row.original.id }}
            className="fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {row.original.fullName ?? '—'}
          </Link>
        ),
      },
      {
        header: 'Email',
        accessorKey: 'email',
        cell: ({ row }) => (
          <span className="mono" style={{ fontSize: 11 }}>
            {row.original.email}
          </span>
        ),
      },
      {
        header: 'Role',
        accessorKey: 'role',
        cell: ({ row }) => (
          <span className={`badge ${roleBadgeClass(row.original.role)}`}>{row.original.role}</span>
        ),
      },
      {
        header: 'Phone',
        cell: ({ row }) => (
          <span className="text2" style={{ fontSize: 11 }}>
            {row.original.phone ?? '—'}
          </span>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <span className={`badge ${row.original.isActive ? 'b-green' : 'b-amber'}`}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        header: 'Approver',
        cell: ({ row }) => {
          const isApprover =
            row.original.role === 'admin' || approverSet.has(row.original.id);
          return isApprover ? (
            <span
              style={{
                fontSize: 10,
                color: 'var(--green)',
                fontWeight: 700,
              }}
              title={row.original.role === 'admin' ? 'Admin always approves' : 'PO approver'}
            >
              ✅ PO
            </span>
          ) : (
            <span className="text3" style={{ fontSize: 10 }}>—</span>
          );
        },
      },
      {
        header: 'Actions',
        cell: ({ row }) => (
          <Link
            to="/users/$id/edit"
            params={{ id: row.original.id }}
            className="btn btn-ghost btn-sm"
          >
            <Pencil size={13} /> Edit
          </Link>
        ),
      },
    ],
    [approverSet],
  );

  const table = useReactTable({
    data: data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Admin access required.
        </div>
      </div>
    );
  }

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
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            👥 User Management
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Manage team — rename, change role, deactivate. New users are invited via Supabase Auth;
            once they sign in, they appear here.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search name or email…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.role ?? ''}
            onChange={(e) => {
              const v = e.target.value as UserRole | '';
              void navigate({
                search: (prev) => ({ ...prev, role: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All roles</option>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
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
                    {error instanceof Error ? error.message : 'Failed to load users'}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="empty-state">
                    No users match these filters.
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
            ? 'No users'
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
