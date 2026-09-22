// User Management list — Phase A item 5a. Mirrors legacy renderUsers L13435.
// Admin-only. Insert is intentionally absent (Supabase Auth owns invites).
//
// 0100 adds an Access column. Role and access used to live on two screens
// with no link between them, so "what can this person actually do?" could
// not be answered from either one alone: the role says what the database
// will accept, the tier says how much of that they are given. Both belong
// on the row.
//
// The Role column became a DEPARTMENT column (ADR-136). "Which department is
// Rajesh in?" is the question this list is actually asked; "is Rajesh a
// manager?" was an implementation detail leaking onto a people screen. The
// derived role is not shown here at all — a department name and a role word
// side by side read as two answers to one question. It lives in the Access
// Control Configure box and on the user Edit page, the two screens where you
// are actually deciding or investigating.
//
// Laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO / WO
// List view look — see sales-orders/components/so-sheet-table.tsx): Sr No
// first, Action last, fixed `%` widths that add up to 100 so nothing scrolls
// sideways, every column centred by the class except Name, which reads from
// its left edge. Per-column sorting was dropped with the TanStack table (the
// SO standard has none; it only ever re-ordered the page on screen).

import { ACCESS_DEPTS, USER_ROLES, type ListUsersQuery, type UserRole } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Lock, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useApprovalConfig } from '@/modules/approval-config/api';
import { useUserAccessList } from '@/modules/access-control/api';
import { useUsersList } from '../api';

const PAGE_SIZE = 25;
/** Column count — the loading / error / empty rows' <td colSpan> must always
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 9;

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
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Vinay   Makwana " and "Vinay Makwana" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
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
  const approverSet = useMemo(() => new Set(approvalCfg?.poApprovers ?? []), [approvalCfg]);

  // Access matrix summary per user, so the Access column can answer "what do
  // they get?" without a second trip to the Access Control screen. Same
  // admin-only endpoint that screen uses, so it costs one cached query.
  const { data: accessList } = useUserAccessList();
  const accessByUser = useMemo(
    () => new Map((accessList?.items ?? []).map((a) => [a.userId, a])),
    [accessList],
  );

  const rows = data?.items ?? [];
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
      {/* Sticky header band — the SO list's shape: `#content` is the app's
          scroll container, so `top:0` pins this band flush under the topbar
          while the rows scroll underneath. Opaque `--bg` so the sheet never
          shows through. */}
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
            alignItems: 'flex-start',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              👥 User Management
            </div>
            {/* Count is the list response's `total` — the only aggregate the
                endpoint returns. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} user{total === 1 ? '' : 's'}
              {search.role ? (
                <>
                  {' '}
                  · <span className="text2">{search.role}</span> only
                </>
              ) : null}
              {search.isActive !== undefined ? (
                <>
                  {' '}
                  · <span className="text2">{search.isActive ? 'Active' : 'Inactive'}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search this list…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
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
            <Link to="/users/new" className="btn btn-primary">
              <Plus size={14} /> Add User
            </Link>
          </div>
        </div>
      </div>

      {/* The sheet: fixed widths summing to 100%, so no sideways scroll. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '17%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th style={{ textAlign: 'left' }}>Name</th>
              <th>Department</th>
              <th>Access</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Approver</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state" style={{ color: 'var(--red)' }}>
                  {error instanceof Error ? error.message : 'Failed to load users'}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  No users match these filters.
                </td>
              </tr>
            ) : (
              rows.map((u, i) => {
                const deptKey = accessByUser.get(u.id)?.mainDept ?? null;
                const dept = deptKey ? ACCESS_DEPTS.find((d) => d.key === deptKey) : undefined;
                const access = accessByUser.get(u.id);
                const isApprover = u.role === 'admin' || approverSet.has(u.id);
                return (
                  // A user has no detail page — Edit is where the name link
                  // has always gone, so the row opens the same place.
                  <tr
                    key={u.id}
                    onClick={() => void navigate({ to: '/users/$id/edit', params: { id: u.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="text3">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                    <td
                      style={{
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={u.fullName ?? ''}
                    >
                      <Link
                        to="/users/$id/edit"
                        params={{ id: u.id }}
                        className="fw-700"
                        style={{ color: 'var(--text)', textDecoration: 'none' }}
                        title="Edit this user"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {u.fullName ?? '—'}
                      </Link>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {dept ? (
                        <span style={{ color: dept.color, fontWeight: 700, fontSize: 12 }}>
                          {dept.label}
                        </span>
                      ) : (
                        <span className="text3" style={{ fontSize: 11 }}>
                          —
                        </span>
                      )}
                    </td>
                    <td
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={access?.tierSummary ?? ''}
                    >
                      {!access ? (
                        <span className="text3" style={{ fontSize: 10 }}>
                          —
                        </span>
                      ) : access.fullAccess ? (
                        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 10 }}>
                          L6 Super Admin
                        </span>
                      ) : access.auditor ? (
                        <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 10 }}>
                          L7 Auditor
                        </span>
                      ) : access.tierSummary ? (
                        <span style={{ fontSize: 10 }}>{access.tierSummary}</span>
                      ) : (
                        <span
                          style={{ color: 'var(--red)', fontSize: 10, fontWeight: 600 }}
                          title="No tier set — this person can see nothing until you configure them."
                        >
                          No access
                        </span>
                      )}
                    </td>
                    <td
                      className="mono"
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={u.email}
                    >
                      {u.email}
                    </td>
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {u.phone ?? '—'}
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'b-green' : 'b-amber'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {isApprover ? (
                        <span
                          style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}
                          title={u.role === 'admin' ? 'Admin always approves' : 'PO approver'}
                        >
                          ✅ PO
                        </span>
                      ) : (
                        <span className="text3" style={{ fontSize: 10 }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      {/* Icon buttons on one row, the action named on hover; the
                          row navigates, so the wrapper stops the click. */}
                      <div
                        style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          to="/users/$id/edit"
                          params={{ id: u.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </Link>
                        <Link
                          to="/access-control"
                          search={{ configure: u.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Access"
                          aria-label="Access"
                        >
                          <Lock size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
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

      {/* Legacy L13469 tips this as "Edit manages everything ... all in one window" — that
          describes legacy's _unifiedUserForm. This port deliberately splits it: Edit owns the
          basic fields + approval limit + password, while department / form permissions live on
          Access Control, and email is owned by Supabase Auth. Tip reworded to match what Edit
          actually does — see ISSUE-021. */}
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Click <b>✏ Edit</b> to manage a user: name, role, phone, status, PO approval limit and
        password. Department + form permissions are managed on <b>Access Control</b>. Click{' '}
        <b>+ Add User</b> to create a login and app account in one step.
      </div>
    </div>
  );
}
