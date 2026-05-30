// Access Control matrix list — admin-only.
//
// Mirror of legacy `renderAccessControl` (HTML L13861): one row per user
// with role select + Departments count + Forms count + Configure button.
// Inline role-change → PATCH /users/:id (legacy `_changeUserRole`).
// Configure → modal (ConfigureAccessModal) → PUT /access-control/users/:id.

import type { UserAccessListItem, UserRole } from '@innovic/shared';
import { USER_ROLES } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useUpdateUser } from '@/modules/users/api';
import { useUserAccessList } from '../api';
import { ConfigureAccessModal } from '../components/configure-modal';

export const accessControlListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'access-control',
  component: AccessControlListPage,
});

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'b-red';
  if (role === 'manager') return 'b-blue';
  if (role === 'operator') return 'b-amber';
  if (role === 'qc') return 'b-cyan';
  return 'b-grey';
}

function AccessControlListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading, isError, error } = useUserAccessList();
  const [editing, setEditing] = useState<UserAccessListItem | null>(null);

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
            Per-user departments + form-level View / Entry / Edit permissions. New users start
            unconfigured (the matrix is opt-in until you save).
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>User</th>
                <th style={{ width: 160 }}>Role</th>
                <th className="td-ctr" style={{ width: 130 }}>
                  Departments
                </th>
                <th className="td-ctr" style={{ width: 100 }}>
                  Forms
                </th>
                <th style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={5} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load matrix'}
                  </td>
                </tr>
              ) : (data?.items ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
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

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Click Configure to set department access and form-level View / Entry / Edit permissions per user.
        Server-side write-gating is a follow-up audit task (see ADR-035) — the matrix gates UI visibility today.
      </div>

      {editing ? (
        <ConfigureAccessModal
          userId={editing.userId}
          userName={editing.userName ?? editing.userEmail}
          userRole={editing.role as UserRole}
          onClose={() => setEditing(null)}
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
  const updateUser = useUpdateUser(u.userId);
  const [role, setRole] = useState<UserRole>(u.role as UserRole);

  function onRoleChange(next: UserRole): void {
    if (next === role) return;
    setRole(next);
    updateUser.mutate({ role: next });
  }

  return (
    <tr>
      <td className="fw-700">{u.userName ?? u.userEmail}</td>
      <td>
        <select
          className="innovic-select"
          value={role}
          onChange={(e) => onRoleChange(e.target.value as UserRole)}
          disabled={updateUser.isPending}
          style={{ fontSize: 11, fontWeight: 700, padding: '3px 6px' }}
        >
          {USER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>{' '}
        <span className={`badge ${roleBadgeClass(role)}`}>{role}</span>
      </td>
      <td className="td-ctr">
        {u.fullAccess ? (
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>✅ Full Access</span>
        ) : (
          `${u.deptCount}/${u.totalDepts}`
        )}
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
