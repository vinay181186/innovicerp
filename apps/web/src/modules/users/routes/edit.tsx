// User edit — admin-only. Rename / change role / phone / activate-deactivate /
// soft-delete. Self-demote + self-deactivate + self-delete are blocked client
// + server.

import { USER_ROLES, type UpdateUserInput, type UserRole } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoftDeleteUser, useUpdateUser, useUser } from '../api';

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
}

function UserEditPage(): React.JSX.Element {
  const { id } = userEditRoute.useParams();
  const navigate = useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data: detail, isLoading, isError, error } = useUser(isAdmin ? id : undefined);
  const update = useUpdateUser(id);
  const softDelete = useSoftDeleteUser();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { register, handleSubmit, formState } = useForm<FormValues>({
    values: detail
      ? {
          fullName: detail.fullName ?? '',
          role: detail.role,
          phone: detail.phone ?? '',
          isActive: detail.isActive,
        }
      : { fullName: '', role: 'viewer', phone: '', isActive: true },
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
    const payload: UpdateUserInput = {
      fullName: values.fullName.trim() || undefined,
      role: values.role,
      phone: values.phone.trim() || undefined,
      isActive: values.isActive,
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
              ✏ Edit user
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
            <div className="form-grid form-grid-3">
              <div className="form-grp">
                <label className="form-label" htmlFor="fullName">
                  Full name
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
                <select id="role" className="innovic-select fw-700" {...register('role')}>
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r} disabled={isSelf && r !== 'admin'}>
                      {r}
                    </option>
                  ))}
                </select>
                {isSelf ? (
                  <div className="form-help">Cannot demote yourself.</div>
                ) : null}
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
                {isSelf ? (
                  <div className="form-help">Cannot deactivate yourself.</div>
                ) : null}
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  className="innovic-input"
                  value={detail.email}
                  readOnly
                  style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
                />
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
                  Save changes
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
