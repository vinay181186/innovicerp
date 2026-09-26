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
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), with the one difference this screen
// carries: it is SERVER-PAGED, so ListFooter runs in pager mode instead of
// the scroll mode the masters use.
//
//   <ListHeader>   title · count · SearchInput · role + status filters · ⟳ · + Add User
//   <Panel><DataTable>  THE ruled sheet — loading and empty are its own states
//   <ListFooter page>   Showing 26–50 of 312 · Prev / Next · 💡 hint
//   <PageState>         the admin-only gate and the load failure
//
// Gone from this file: the hand-rolled sticky band, the bare <input>/<select>
// pair, the <table>/<colgroup>/<thead>, the three colSpan state rows, the
// badge, the row-action cluster and the hand-written pager. What stays is the
// DATA and the RULES: the query, the admin gate, the two lookup maps behind
// the Department / Access / Approver columns, and the URL parameters.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write (which also resets to page 1), normalizeSearchTerm, the
// admin-only `enabled` on the list query, the row and the Name cell both
// opening Edit (a user has no detail page), and the Access shortcut carrying
// `configure=<id>` into Access Control.

import {
  ACCESS_DEPTS,
  USER_ROLES,
  type ListUsersQuery,
  type UserAccessListItem,
  type UserRole,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { Select } from '@/ui/forms';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useApprovalConfig } from '@/modules/approval-config/api';
import { useUserAccessList } from '@/modules/access-control/api';
import { useUsersList } from '../api';
import { ROLE_LABEL } from '@/lib/role-label';

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

/** The three shapes the Access column can be in. Each one is a different
 *  answer to "what does this person get?", so each keeps its own colour. */
function AccessCell({ access }: { access: UserAccessListItem | undefined }): React.JSX.Element {
  if (!access) return <span className="text3">—</span>;
  if (access.fullAccess)
    return (
      <span className="fw-700" style={{ color: 'var(--green2)', fontSize: 'var(--fs-xs)' }}>
        L6 Super Admin
      </span>
    );
  if (access.auditor)
    return (
      <span className="fw-700" style={{ color: 'var(--amber2)', fontSize: 'var(--fs-xs)' }}>
        L7 Auditor
      </span>
    );
  if (access.tierSummary)
    return <span style={{ fontSize: 'var(--fs-xs)' }}>{access.tierSummary}</span>;
  // No tier at all is not "nothing to show" — it is a person who cannot open a
  // single page, and it stays red so an admin spots it from the list.
  return (
    <span
      className="fw-700"
      style={{ color: 'var(--red2)', fontSize: 'var(--fs-xs)' }}
      title="No tier set — this person can see nothing until you configure them."
    >
      No access
    </span>
  );
}

function UsersListPage(): React.JSX.Element {
  const search = usersListRoute.useSearch();
  const navigate = usersListRoute.useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Vinay   Makwana " and "Vinay Makwana" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
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

  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  const currentPage = search.page;

  // "12 users · admin · Active only". Both filters are optional and either can
  // be on alone, so the note is built here and left UNDEFINED when neither is —
  // ListHeader prints "· … only" for anything it is given, including an empty
  // fragment.
  const filterParts = [
    search.role,
    search.isActive === undefined ? undefined : search.isActive ? 'Active' : 'Inactive',
  ].filter((p): p is string => p !== undefined);
  const filterNote = filterParts.length > 0 ? filterParts.join(' · ') : undefined;

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+17+11+14+20+10+8+8 = 92, + 8 = 100, so
  // the table never scrolls sideways. Centred by the standard; only Name is
  // left-aligned so the people's names share one edge.
  const columns = useMemo<DataTableColumn<(typeof rows)[number]>[]>(
    () => [
      {
        header: 'Sr No',
        width: '4%',
        className: 'text3',
        render: (_u, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'Name',
        width: '17%',
        align: 'left',
        ellipsis: true,
        title: (u) => u.fullName ?? '',
        // A real link, so the name can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (u) => (
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
        ),
      },
      {
        header: 'Department',
        width: '11%',
        nowrap: true,
        render: (u) => {
          const deptKey = accessByUser.get(u.id)?.mainDept ?? null;
          const dept = deptKey ? ACCESS_DEPTS.find((d) => d.key === deptKey) : undefined;
          // The department's own colour comes from ACCESS_DEPTS (@innovic/shared),
          // so the nav, the Access Control screen and this list cannot disagree.
          return dept ? (
            <span className="fw-700" style={{ color: dept.color, fontSize: 'var(--fs-sm)' }}>
              {dept.label}
            </span>
          ) : (
            <span className="text3">—</span>
          );
        },
      },
      {
        header: 'Access',
        width: '14%',
        ellipsis: true,
        title: (u) => accessByUser.get(u.id)?.tierSummary ?? '',
        render: (u) => <AccessCell access={accessByUser.get(u.id)} />,
      },
      {
        header: 'Email',
        width: '20%',
        className: 'mono',
        ellipsis: true,
        key: 'email',
      },
      {
        header: 'Phone',
        width: '10%',
        className: 'text2',
        nowrap: true,
        render: (u) => u.phone ?? '—',
      },
      {
        header: 'Active',
        width: '8%',
        nowrap: true,
        // `useractive`, not the generic `active` map: a deactivated login is
        // amber on this screen, not red — somebody who has left is not a fault.
        render: (u) => <StatusBadge kind="useractive" status={String(u.isActive)} />,
      },
      {
        header: 'Approver',
        width: '8%',
        nowrap: true,
        render: (u) =>
          u.role === 'admin' || approverSet.has(u.id) ? (
            <span
              className="fw-700"
              style={{ color: 'var(--green2)', fontSize: 'var(--fs-xs)' }}
              title={u.role === 'admin' ? 'Admin always approves' : 'PO approver'}
            >
              ✅ PO
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
    ],
    [accessByUser, approverSet, currentPage],
  );

  // Admin-only screen. Its own wording, not PageState's generic no-access
  // sentence: this page is hidden by ROLE, not by an Access Control switch,
  // so "ask an admin for access" would be the wrong instruction.
  if (!isAdmin) {
    return <PageState as="page" state="noaccess" message="⛔ Admin access required." />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, the two filters and the
          primary action stay put while the rows scroll underneath. */}
      <ListHeader
        title="User Management"
        icon="👥"
        count={total}
        noun="user"
        filterNote={filterNote}
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        filters={
          <>
            <Select
              aria-label="Filter by role"
              title="Role"
              value={search.role ?? ''}
              onChange={(e) => {
                const v = e.target.value as UserRole | '';
                void navigate({
                  search: (prev) => ({ ...prev, role: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              options={[
                { value: '', label: 'All roles' },
                ...USER_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
              ]}
            />
            <Select
              aria-label="Filter by active"
              title="Active"
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
              options={[
                { value: '', label: 'All' },
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Inactive' },
              ]}
            />
          </>
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              role: undefined,
              isActive: undefined,
              search: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={!!search.role || search.isActive !== undefined || searchInput.trim() !== ''}
        primary={
          <Link to="/users/new" className="btn btn-primary">
            <Icon name="plus" size={14} /> Add User
          </Link>
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load users. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText="No users match these filters."
            // A user has no detail page — Edit is where the name link has
            // always gone, so the row opens the same place.
            onRowClick={(u) => void navigate({ to: '/users/$id/edit', params: { id: u.id } })}
            rowActionsWidth="8%"
            rowActions={(u) => (
              <RowActions
                // Edit is a ROUTE, so it stays a real link — ctrl-click /
                // middle-click still open a new tab. There is no View (no
                // detail page) and no Delete (Supabase Auth owns the account).
                editTo={`/users/${u.id}/edit`}
                renderLink={(p) => <Link {...p} />}
                extra={
                  // The Access shortcut is this screen's own action, not one of
                  // the three RowActions knows about, so it comes in through
                  // `extra` — still a real <Link>, carrying `configure=<id>` so
                  // Access Control opens straight onto this person.
                  <Link
                    to="/access-control"
                    search={{ configure: u.id }}
                    className="btn btn-ghost btn-sm btn-icon"
                    style={{ padding: 'var(--sp-1)' }}
                    title="Access"
                    aria-label="Access"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* The padlock is the app's access glyph (users/routes/edit.tsx,
                        access-control, trash, backup). The Icon set carries no
                        lock, and swapping in a different glyph on one screen
                        would break that association. */}
                    <Lock size={13} />
                  </Link>
                }
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="user"
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />
    </div>
  );
}
