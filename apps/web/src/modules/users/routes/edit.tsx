// User edit — admin-only. Rename / change role / phone / activate-deactivate /
// soft-delete. Self-demote + self-deactivate + self-delete are blocked client
// + server.

import { USER_ROLES, type UpdateUserInput, type UserRole } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSetUserPassword, useSoftDeleteUser, useUpdateUser, useUser } from '../api';

export const userEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'users/$id/edit',
  component: UserEditPage,
});

interface FormValues {
  fullName: string;
  role: UserRole;
  phone: string;
  isActive: boolean;
  approvalLimit: string;
}

function UserEditPage(): React.JSX.Element {
  const { id } = userEditRoute.useParams();
  const navigate = useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data: detail, isLoading, isError, error } = useUser(isAdmin ? id : undefined);
  const update = useUpdateUser(id);
  const softDelete = useSoftDeleteUser();
  const setPassword = useSetUserPassword(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    values: detail
      ? {
          fullName: detail.fullName ?? '',
          role: detail.role,
          phone: detail.phone ?? '',
          isActive: detail.isActive,
          approvalLimit: detail.approvalLimit ?? '',
        }
      : { fullName: '', role: 'viewer', phone: '', isActive: true, approvalLimit: '' },
  });

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Admin access required.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading user…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/users" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'User not found'}
          </div>
        </div>
      </div>
    );
  }

  const isSelf = me?.id === detail.id;

  const onValid = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    // Empty field clears the personal limit (→ null); otherwise parse the
    // number. A blank-after-set is meaningful, so we always send the key.
    const trimmedLimit = values.approvalLimit.trim();
    const approvalLimit = trimmedLimit === '' ? null : Number(trimmedLimit);
    const payload: UpdateUserInput = {
      fullName: values.fullName.trim() || undefined,
      role: values.role,
      phone: values.phone.trim() || undefined,
      isActive: values.isActive,
      approvalLimit: Number.isNaN(approvalLimit) ? null : approvalLimit,
    };
    try {
      await update.mutateAsync(payload);
      void navigate({ to: '/users' });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save changes.');
    }
  };

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/users', replace: true });
      },
    });
  };

  const onSetPassword = async (): Promise<void> => {
    setPwMsg(null);
    if (newPassword.length < 8) {
      setPwMsg({ kind: 'err', text: 'Password must be at least 8 characters.' });
      return;
    }
    try {
      await setPassword.mutateAsync({ password: newPassword });
      setNewPassword('');
      setPwMsg({
        kind: 'ok',
        text: `Password set for ${detail.email}. Hand it over directly — no email is sent.`,
      });
    } catch (e) {
      setPwMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Failed to set password.' });
    }
  };

  return (
    <div>
      <Link to="/users" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to User Management
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="fw-700" style={{ color: 'var(--cyan)', fontSize: 14 }}>
              {detail.email}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              👤 Edit User{detail.fullName ? ` — ${detail.fullName}` : ''}
            </div>
            {isSelf ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                ℹ This is you — self-demote + self-deactivate + self-delete are blocked.
              </div>
            ) : null}
          </div>
          {!isSelf ? (
            confirmDelete ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="text3" style={{ fontSize: 12 }}>
                  Delete?
                </span>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={onDelete}
                  disabled={softDelete.isPending}
                >
                  {softDelete.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  Confirm
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={softDelete.isPending}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={13} /> Delete
              </button>
            )
          ) : null}
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete user.'}
            </div>
          ) : null}
          <form onSubmit={handleSubmit(onValid)}>
            {/* Field order mirrors legacy BASIC INFO (L13484-13495): Name, Role, Email —
                then this port's own fields (phone, status), then legacy's APPROVAL RIGHTS
                limit (L13538) last. Kept identical to create.tsx, which is how legacy gets
                it for free: _unifiedUserForm builds one form for both modes. Name carries no
                ★ here because updateUserInputSchema.fullName is optional (create's is
                .min(1)) — the only field that legitimately differs between the two files. */}
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label" htmlFor="fullName">
                  Name
                </label>
                <input
                  id="fullName"
                  className="innovic-input"
                  autoComplete="off"
                  placeholder="e.g. Rajesh K."
                  {...register('fullName', { maxLength: { value: 255, message: 'Max 255 chars' } })}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="role">
                  Role<span className="req">★</span>
                </label>
                {/* Legacy's own <select> (L13486-13492) lists admin/manager/sr_engineer/
                    engineer/jn_engineer/operator/viewer — a set that does not map to ours.
                    Porting it would drop qc/procurement/dispatch/design and silently rewrite
                    those users' roles on save (ISSUE-104). Our USER_ROLES stays. */}
                <select id="role" className="innovic-select fw-700" {...register('role')}>
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r} disabled={isSelf && r !== 'admin'}>
                      {r}
                    </option>
                  ))}
                </select>
                {isSelf ? <div className="form-help">Cannot demote yourself.</div> : null}
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="email">
                  Email
                </label>
                <input id="email" className="innovic-input" value={detail.email} readOnly />
                <div className="form-help">Owned by Supabase Auth — change there.</div>
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  className="innovic-input"
                  autoComplete="off"
                  placeholder="+91-..."
                  {...register('phone', { maxLength: { value: 32, message: 'Max 32 chars' } })}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="isActive">
                  Status
                </label>
                <select
                  id="isActive"
                  className="innovic-select"
                  disabled={isSelf}
                  {...register('isActive', { setValueAs: (v) => v === 'true' || v === true })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
                {isSelf ? <div className="form-help">Cannot deactivate yourself.</div> : null}
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="approvalLimit">
                  Approval Limit (₹)
                </label>
                <input
                  id="approvalLimit"
                  className="innovic-input"
                  type="number"
                  min={0}
                  step={1000}
                  autoComplete="off"
                  placeholder="e.g. 100000"
                  disabled={detail.role === 'admin'}
                  {...register('approvalLimit')}
                />
                <div className="form-help">
                  {detail.role === 'admin'
                    ? 'Admin has unlimited approval.'
                    : 'PO above this amount will need higher authority approval. Blank = use company manager limit.'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              {submitError ? (
                <div
                  style={{
                    color: 'var(--red)',
                    background: 'var(--red3)',
                    border: '1px solid #fca5a5',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 12,
                    marginBottom: 10,
                  }}
                >
                  {submitError}
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void navigate({ to: '/users' })}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={formState.isSubmitting || update.isPending}
                >
                  {formState.isSubmitting || update.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : null}
                  Save User
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            <KeyRound size={14} style={{ display: 'inline', marginRight: 4 }} />
            Set / reset password
          </div>
        </div>
        <div className="panel-body">
          <div className="text3" style={{ fontSize: 12, marginBottom: 10 }}>
            Sets this user&rsquo;s password directly — <strong>no email is sent</strong>, so it
            works regardless of mail delivery or rate limits. Type a new password and hand it to{' '}
            {isSelf ? 'note it for yourself' : detail.email} directly.
          </div>
          {pwMsg ? (
            <div
              style={{
                color: pwMsg.kind === 'ok' ? 'var(--green)' : 'var(--red)',
                background: pwMsg.kind === 'ok' ? 'var(--green3, #dcfce7)' : 'var(--red3)',
                border: `1px solid ${pwMsg.kind === 'ok' ? '#86efac' : '#fca5a5'}`,
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {pwMsg.text}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-grp" style={{ minWidth: 240 }}>
              <label className="form-label" htmlFor="newPassword">
                New password
              </label>
              <input
                id="newPassword"
                className="innovic-input"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void onSetPassword()}
              disabled={setPassword.isPending || newPassword.length === 0}
            >
              {setPassword.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
              Set password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
