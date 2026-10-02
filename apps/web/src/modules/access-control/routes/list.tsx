// Access Control matrix list — admin-only.
//
// Mirror of legacy `renderAccessControl` (HTML L13861): one row per user
// with Tiers + Departments count + Forms count + Configure action, now on the
// shared FIT table (ADR-199: <DataTable tableKey=…>) like every other list.
// Configure → modal (ConfigureAccessModal) → PUT /access-control/users/:id.
//
// 0100 added the "Tiers by department" column — the row's headline. The
// counts alone ("3/9 departments") never said what the person could DO in
// those departments, which was the whole complaint the tier model answers.
//
// The inline role dropdown that used to sit on each row is gone. Role now
// lives in exactly ONE control, inside Configure, next to the tiers it caps
// and next to the warning that fires when a tier outruns it. Two controls for
// one value on the same screen is the duplication this screen was cleaning up
// in User Management; keeping it here would have been the same mistake.
//
// `?configure=<userId>` opens that user's box straight away, so creating a
// user in User Management lands here mid-flow instead of asking the admin to
// find the row again.
//
// Columns, the stale-enforcement warning (▸ detail) and the ⋯ menu live in
// components/access-list-columns.tsx. The tier logic is unchanged.

import type { UserAccessListItem } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useUserAccessList, useUserAccessPage } from '../api';
import { ConfigureAccessModal } from '../components/configure-modal';
import { accessListColumns, accessRowMenu, accessRowTint } from '../components/access-list-columns';

const accessControlSearchSchema = z.object({
  configure: z.string().uuid().optional(),
  page: pageSearchParam,
});

export const accessControlListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'access-control',
  validateSearch: accessControlSearchSchema,
  component: AccessControlListPage,
});

function AccessControlListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const navigate = accessControlListRoute.useNavigate();
  const { configure, page } = accessControlListRoute.useSearch();
  const isAdmin = me?.role === 'admin';
  const [editing, setEditing] = useState<UserAccessListItem | null>(null);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );

  // ADR-201: 25 users a page; the search box, Sort & Filter and paging run on
  // the server over every user. Any change of search / ▾ → page 1.
  useEffect(() => {
    const trimmed = normalizeSearchTerm(term);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.accessControlList, () => gotoPage(1));

  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useUserAccessPage({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  useClampPage(page, data?.total, gotoPage);

  const columns = useMemo(() => accessListColumns(), []);

  // Arriving from "create user" with ?configure=<id>: open that row's box as
  // soon as the list resolves, so the two screens read as one action. The
  // user may not be on the page on screen, so this looks in the WHOLE list
  // (fetched only while ?configure is set). The param is cleared on close so
  // a back-navigation doesn't reopen it.
  const { data: everyone } = useUserAccessList({ enabled: Boolean(configure) });
  const items = everyone?.items;
  useEffect(() => {
    if (!configure || !items) return;
    const hit = items.find((u) => u.userId === configure);
    if (hit) setEditing(hit);
  }, [configure, items]);

  const closeModal = (): void => {
    setEditing(null);
    if (configure) {
      void navigate({ search: (prev) => ({ ...prev, configure: undefined }), replace: true });
    }
  };

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          You do not have permission to view Access Control. Ask an admin.
        </div>
      </div>
    );
  }

  // The server matches the search over name / email, department, tier
  // summary and role — the columns on screen — before cutting the page.
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    // `page-fill` (ADR-201): the TABLE is this page's only scrollbar, so the
    // column header cannot ride off the top of the screen at the last row.
    <div className="page-fill">
      <ListHeader
        title="Access Control"
        icon="🔒"
        count={data ? total : undefined}
        noun="user"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search user, email, department, tiers…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setTerm('');
        }}
        filtersActive={sf.filtering || term !== ''}
      />

      <Panel fill bodyPadding="none">
        <DataTable
          tableKey={TABLE_KEYS.accessControlList}
          columns={columns}
          rows={rows}
          loading={isLoading}
          rowKey={(u) => u.userId}
          sortFilterServer={sf}
          defaultHidden={['enforcement_warning']}
          rowClassName={(u) => accessRowTint(u)}
          rowMenu={(u) => accessRowMenu(() => setEditing(u))}
          empty={
            isError ? (
              <span style={{ color: 'var(--red2)' }}>
                {error instanceof Error
                  ? error.message
                  : 'Could not load access settings. Try again.'}
              </span>
            ) : term.trim() || sf.filtering ? (
              'No users match.'
            ) : (
              'No users yet. Create users in User Management first.'
            )
          }
        />
      </Panel>

      <ListFooter
        total={total}
        noun="user"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        Admins always have full access.
      </div>

      {editing ? (
        <ConfigureAccessModal
          userId={editing.userId}
          userName={editing.userName ?? editing.userEmail}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}
