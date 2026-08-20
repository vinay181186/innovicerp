// Access Control matrix list — admin-only.
//
// Mirror of legacy `renderAccessControl` (HTML L13861): one row per user
// with Tiers + Departments count + Forms count + Configure button.
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

import { ACCESS_DEPTS, type UserAccessListItem } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useUserAccessList } from '../api';
import { ConfigureAccessModal } from '../components/configure-modal';

const accessControlSearchSchema = z.object({
  configure: z.string().uuid().optional(),
});

export const accessControlListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'access-control',
  validateSearch: accessControlSearchSchema,
  component: AccessControlListPage,
});

function deptLabel(key: string | null): { label: string; color: string } | null {
  if (!key) return null;
  const d = ACCESS_DEPTS.find((x) => x.key === key);
  return d ? { label: d.label, color: d.color } : null;
}

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'b-red';
  if (role === 'manager') return 'b-blue';
  if (role === 'operator') return 'b-amber';
  if (role === 'qc') return 'b-cyan';
  return 'b-grey';
}

function AccessControlListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const navigate = accessControlListRoute.useNavigate();
  const { configure } = accessControlListRoute.useSearch();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading, isError, error } = useUserAccessList();
  const [editing, setEditing] = useState<UserAccessListItem | null>(null);

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
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          Admin access required.
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
        }}
      >
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            🔒 Access Control
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Pick the department someone works in and their level follows; add other departments
            below it as needed. L6 Super Admin and L7 Auditor are whole-account levels. This is
            also where the PO approval limit is set — User Management only handles who they are.
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>User</th>
                <th style={{ width: 150 }}>Department</th>
                <th>Tiers by department</th>
                <th className="td-ctr" style={{ width: 100 }}>
                  Departments
                </th>
                <th className="td-ctr" style={{ width: 90 }}>
                  Extras
                </th>
                <th style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={6} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load matrix'}
                  </td>
                </tr>
              ) : (data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No users. Create users in User Management first.
                  </td>
                </tr>
              ) : (
                (data?.items ?? []).map((u) => <UserAccessRow key={u.userId} u={u} onConfigure={() => setEditing(u)} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
        💡 Click Configure to set someone's department, their level in it, and any form-level
        extras.
        <br />
        <b>The role is worked out for you.</b> It is no longer something you pick — it follows
        from the departments and levels you grant, so the two can never disagree. It is still what
        the server checks on every save, which is why the row shows it.
        <br />
        <b>An empty matrix now denies.</b> A user with no tier saved sees nothing at all —
        it used to mean "allow everything until configured", which left the person nobody had
        set up with more access than the person you had. Admins always bypass, so you can never
        lock yourself out.
        <br />
        Server-side enforcement is live for <b>Approve</b> (Purchase Orders and Purchase
        Requests). The other modules still gate writes on the role alone — extending the matrix to
        them is the follow-up sweep (ADR-035).
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

function UserAccessRow({
  u,
  onConfigure,
}: {
  u: UserAccessListItem;
  onConfigure: () => void;
}): React.JSX.Element {
  const dept = deptLabel(u.mainDept);
  return (
    <tr>
      <td className="fw-700">{u.userName ?? u.userEmail}</td>
      <td>
        {dept ? (
          <span style={{ color: dept.color, fontWeight: 700, fontSize: 12 }}>{dept.label}</span>
        ) : (
          <span className="text3" style={{ fontSize: 11 }}>—</span>
        )}
        {/* The derived role, shown small. It is not chosen any more, but it is
            still what the server checks on every save, so hiding it entirely
            would make a refusal impossible to explain. */}
        <div className="text3" style={{ fontSize: 9, marginTop: 1 }}>
          saved as <span className={`badge ${roleBadgeClass(u.role)}`}>{u.role}</span>
        </div>
      </td>
      <td style={{ fontSize: 11 }}>
        {u.fullAccess ? (
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>L6 Super Admin — everything</span>
        ) : u.auditor ? (
          <span style={{ color: 'var(--amber)', fontWeight: 700 }}>
            L7 Auditor — reads everything, writes nothing
          </span>
        ) : u.tierSummary ? (
          u.tierSummary
        ) : (
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>
            Not configured — this person can see nothing. Click Configure.
          </span>
        )}
      </td>
      <td className="td-ctr">
        {u.fullAccess || u.auditor ? <>✅ All</> : `${u.deptCount}/${u.totalDepts}`}
      </td>
      <td className="td-ctr">
        {u.fullAccess ? <>✅ All</> : `${u.formCount}/${u.totalForms}`}
      </td>
      <td>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onConfigure}
          style={{ fontSize: 11 }}
        >
          🔒 Configure
        </button>
      </td>
    </tr>
  );
}
