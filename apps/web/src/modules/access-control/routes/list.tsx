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
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';
import { useUserAccessList } from '../api';
import { ConfigureAccessModal } from '../components/configure-modal';
import {
  accessListColumns,
  accessRowMenu,
  accessRowTint,
  deptLabel,
} from '../components/access-list-columns';
import { roleLabel } from '@/lib/role-label';

const accessControlSearchSchema = z.object({
  configure: z.string().uuid().optional(),
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
  const { configure } = accessControlListRoute.useSearch();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading, isError, error } = useUserAccessList();
  const [editing, setEditing] = useState<UserAccessListItem | null>(null);
  const [term, setTerm] = useState('');

  const columns = useMemo(() => accessListColumns(), []);

  // Arriving from "create user" with ?configure=<id>: open that row's box as
  // soon as the list resolves, so the two screens read as one action. The
  // param is cleared on close so a back-navigation doesn't reopen it.
  const items = data?.items;
  useEffect(() => {
    if (!configure || !items) return;
    const hit = items.find((u) => u.userId === configure);
    if (hit) setEditing(hit);
  }, [configure, items]);

  const closeModal = (): void => {
    setEditing(null);
    if (configure) {
      void navigate({ search: () => ({}), replace: true });
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

  // Client-side search over the whole list (it loads in one fetch): the
  // columns on screen — user name / email, department, tier summary, role.
  const rows = (data?.items ?? []).filter((u) =>
    matchesSearchTerm(
      [u.userName, u.userEmail, deptLabel(u.mainDept)?.label, u.tierSummary, roleLabel(u.role)],
      term,
    ),
  );

  return (
    <div>
      <ListHeader
        title="Access Control"
        icon="🔒"
        count={data ? rows.length : undefined}
        noun="user"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search user, email, department, tiers…"
      />

      <div className="panel">
        <DataTable
          tableKey={TABLE_KEYS.accessControlList}
          columns={columns}
          rows={rows}
          loading={isLoading}
          rowKey={(u) => u.userId}
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
            ) : term.trim() ? (
              'No users match.'
            ) : (
              'No users yet. Create users in User Management first.'
            )
          }
        />
      </div>

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
