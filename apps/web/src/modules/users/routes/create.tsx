// Add User — admin-only. Creates the Supabase Auth account (admin sets the
// initial password) and provisions the public.users row into the admin's
// company. Mirror of legacy renderUsers "+ Add User" (_addUserFull). Access
// matrix + PO-approver flag stay on their own screens, same split as legacy.

import { USER_ROLES, type CreateUserInput, type UserRole } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateUser } from '../api';

export const userCreateRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'users/new',
  component: UserCreatePage,
});

interface FormValues {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
  phone: string;
  isActive: boolean;
  approvalLimit: string;
}

function UserCreatePage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const create = useCreateUser();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    defaultValues: {
      email: '',
      password: '',
      fullName: '',
      role: 'viewer',
      phone: '',
      isActive: true,
      approvalLimit: '',
    },
  });
  const role = watch('role');

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Admin access required.
        </div>
      </div>
    );
  }

  const onValid = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    const trimmedLimit = values.approvalLimit.trim();
    const approvalLimit = trimmedLimit === '' ? null : Number(trimmedLimit);
    const payload: CreateUserInput = {
      email: values.email.trim().toLowerCase(),
      password: values.password,
      fullName: values.fullName.trim(),
      role: values.role,
      phone: values.phone.trim() || undefined,
      isActive: values.isActive,
      approvalLimit: Number.isNaN(approvalLimit) ? null : approvalLimit,
    };
    try {
      const created = await create.mutateAsync(payload);
      void navigate({ to: '/users/$id/edit', params: { id: created.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create user.');
    }
  };

  return (
    <div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
        onClick={() => void navigate({ to: '/users' })}
      >
        <ArrowLeft size={14} /> Back to User Management
      </button>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">👤 Add New User</div>
            {/* Legacy _unifiedUserForm (L13474) bundles department + form access and the
                PO-approver flag into this one window. This port splits them: dept / form
                permissions live on Access Control and the approver flag on Approval Config,
                so the tip must not promise them here (ISSUE-021, same rewording as the list). */}
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Creates the login + the app account in one step. Hand the email and password to the
              user — they can sign in immediately. Department / form access is set on{' '}
              <b>Access Control</b>.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <form onSubmit={handleSubmit(onValid)}>
            {/* Field order mirrors legacy BASIC INFO (L13484-13495): Name, Role, Email —
                then this port's own fields (password, phone, status), then legacy's
                APPROVAL RIGHTS limit (L13538) last. Legacy's PIN (backup) has no port. */}
            <div className="form-grid">
              <div className="form-grp">
                <label className="form-label" htmlFor="fullName">
                  Name<span className="req">★</span>
                </label>
                <input
                  id="fullName"
                  className="innovic-input"
                  autoComplete="off"
                  placeholder="e.g. Rajesh K."
                  {...register('fullName', {
                    required: 'Name is required',
                    maxLength: { value: 255, message: 'Max 255 chars' },
                  })}
                />
                {formState.errors.fullName ? (
                  <div className="form-error">{formState.errors.fullName.message}</div>
                ) : null}
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
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="email">
                  Email<span className="req">★</span>
                </label>
                <input
                  id="email"
                  type="email"
                  className="innovic-input"
                  autoComplete="off"
                  placeholder="user@innovic.com"
                  style={{ color: 'var(--cyan)' }}
                  {...register('email', {
                    required: 'Email is required',
                    pattern: { value: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, message: 'Invalid email' },
                  })}
                />
                {formState.errors.email ? (
                  <div className="form-error">{formState.errors.email.message}</div>
                ) : (
                  <div className="form-help">
                    This is the login email — cannot be changed later here.
                  </div>
                )}
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="password">
                  Initial password<span className="req">★</span>
                </label>
                <input
                  id="password"
                  type="text"
                  className="innovic-input mono"
                  autoComplete="new-password"
                  placeholder="min 8 characters"
                  {...register('password', {
                    required: 'Password is required',
                    minLength: { value: 8, message: 'At least 8 characters' },
                    maxLength: { value: 72, message: 'Max 72 characters' },
                  })}
                />
                {formState.errors.password ? (
                  <div className="form-error">{formState.errors.password.message}</div>
                ) : (
                  <div className="form-help">Shown so you can copy it — share securely.</div>
                )}
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
                  {...register('isActive', { setValueAs: (v) => v === 'true' || v === true })}
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
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
                  disabled={role === 'admin'}
                  {...register('approvalLimit')}
                />
                <div className="form-help">
                  {role === 'admin'
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
                  disabled={formState.isSubmitting || create.isPending}
                >
                  {formState.isSubmitting || create.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : null}
                  Create User
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
