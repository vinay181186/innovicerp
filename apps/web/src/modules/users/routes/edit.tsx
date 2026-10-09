// User edit — admin-only. Rename / phone / activate-deactivate / reset
// password / soft-delete. Self-deactivate + self-delete are blocked client
// + server.
//
// Role and the PO approval limit are NOT here any more — both moved to Access
// Control, which is where department tiers already lived. They are one
// decision ("what may this person do?") and asking it on two screens meant
// neither screen could answer it. Since ADR-136 the role isn't even chosen
// there — an admin picks a DEPARTMENT and the role follows — so this screen
// shows the department, with the derived role underneath it.

import type { UpdateUserInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, KeyRound, Loader2, Lock, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ACCESS_DEPTS } from '@innovic/shared';
import { useUserAccessList } from '@/modules/access-control/api';
import { useFetchUser, useSetUserPassword, useSoftDeleteUser, useUpdateUser, useUser } from '../api';
import { roleLabel } from '@/lib/role-label';
import { Banner, ConfirmDialog } from '@/ui/feedback';

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'b-red';
  if (role === 'manager') return 'b-blue';
  if (role === 'operator') return 'b-amber';
  if (role === 'qc') return 'b-cyan';
  return 'b-grey';
}

export const userEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'users/$id/edit',
  component: UserEditPage,
});

interface FormValues {
  fullName: string;
  phone: string;
  isActive: boolean;
}

// ADR-226 — the fields THIS screen can edit, and what the user calls each one.
//
// The list drives two things: the save sends only the ones whose value actually
// changed, and a notice names the field another person moved. It is written out
// rather than inferred because the user record carries far more than this form
// touches.
//
// `role` and `approvalLimit` are deliberately NOT here. Access Control owns
// both (see the file header and the payload comment below), so this screen must
// never report them as its own edit and must never send a stale copy of them.
// `email` is read-only here and `code`-like permanent, so it is out too.
const USER_EDITABLE = ['fullName', 'phone', 'isActive'] as const;

// The screen's own labels, so a notice reads "Name", never `fullName`. No row
// exists in docs/NAMING.md for any of the three; these are the labels already
// on this form and on users/routes/create.tsx.
const USER_LABELS: Record<string, string> = {
  fullName: 'Name',
  phone: 'Phone',
  isActive: 'Status',
};

/** What the form holds before the user has loaded. One module-level object, so
 *  the `values` react-hook-form is handed is identical on every render until the
 *  real seed arrives. */
const BLANK_FORM: FormValues = { fullName: '', phone: '', isActive: true };

function UserEditPage(): React.JSX.Element {
  const { id } = userEditRoute.useParams();
  const navigate = useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data: detail, isLoading, isError, error } = useUser(isAdmin ? id : undefined);
  const update = useUpdateUser(id);
  const fetchUser = useFetchUser();
  // ADR-226 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes
  // to this one user row, so an admin is told the moment another admin saves it
  // rather than after typing into a stale form.
  const conflict = useEditConflict({
    table: 'users',
    id,
    record: detail,
    refetch: () => fetchUser(id),
    editableKeys: USER_EDITABLE,
    label: (f) => USER_LABELS[f] ?? f,
    noun: 'user',
  });
  const softDelete = useSoftDeleteUser();
  const setPassword = useSetUserPassword(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Their department lives on the access row, not the user record.
  const { data: accessList } = useUserAccessList();

  // ADR-226 — seed the form ONCE, from the user as this screen loaded them.
  //
  // react-hook-form's `values` option is REACTIVE: it re-seeds the form whenever
  // the value it is handed differs from what the form holds. That is the
  // Plan-edit bug (ADR-226) — a background refetch, or the conflict hook's own
  // cache-bypassing re-read after a 409, would throw away whatever the admin had
  // typed, silently, with no save involved. Capturing the first loaded record in
  // a ref keeps the "populate once the record arrives" behaviour (`detail` is
  // undefined on the first render, so plain `defaultValues` would stay blank)
  // without ever re-seeding. Every other edit screen in this batch uses
  // `defaultValues`, which is not reactive and needs no ref.
  const seed = useRef<FormValues | null>(null);
  if (seed.current === null && detail) {
    seed.current = {
      fullName: detail.fullName ?? '',
      phone: detail.phone ?? '',
      isActive: detail.isActive,
    };
  }
  const { register, handleSubmit, formState } = useForm<FormValues>({
    values: seed.current ?? BLANK_FORM,
  });
  const goBack = useCallback(() => void navigate({ to: '/users' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          You do not have permission to edit users. Ask an admin.
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'User not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  const isSelf = me?.id === detail.id;
  const mainDept = (accessList?.items ?? []).find((a) => a.userId === detail.id)?.mainDept ?? null;
  const dept = mainDept ? ACCESS_DEPTS.find((d) => d.key === mainDept) : undefined;

  const onValid = async (values: FormValues): Promise<void> => {
    setSubmitError(null);
    // `role` and `approvalLimit` are deliberately absent from the payload, not
    // sent as their current values: both keys are optional on the API, so
    // omitting them leaves whatever Access Control last set. Sending a stale
    // copy from this form would let the identity screen silently overwrite an
    // access decision made elsewhere.
    //
    // ADR-226 — the trimmed strings are sent AS THEY ARE, blank included. The
    // old `|| undefined` turned a box the admin had CLEARED into "untouched",
    // so clearing a name or a phone number silently did nothing; now the server
    // (which already runs emptyToNull on both) stores the blank. The same
    // one-line fault was fixed in the same way on the QC Process and Cost Centre
    // forms, and tpi-master-form.tsx had already solved it this way.
    const payload: UpdateUserInput = {
      fullName: values.fullName.trim(),
      phone: values.phone.trim(),
      isActive: values.isActive,
    };
    try {
      // Only the fields that actually moved are sent; a 409 re-reads and retries
      // onto the fresh row instead of overwriting another admin's change.
      const saved = await conflict.save(payload, (narrow, expectedUpdatedAt) =>
        update.mutateAsync({ ...narrow, expectedUpdatedAt }),
      );
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (saved === null) return;
      exit.leave(goBack);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save user. Try again.');
    }
  };

  // mutateAsync: ConfirmDialog stays pending while it runs and shows a
  // rejection inside the dialog instead of closing.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(detail.id);
    setConfirmDelete(false);
    exit.leave(() => void navigate({ to: '/users', replace: true }));
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
      setPwMsg({
        kind: 'err',
        text: e instanceof Error ? e.message : 'Could not set password. Try again.',
      });
    }
  };

  return (
    <div>
      {exit.dialog}
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
              Edit User{detail.fullName ? ` — ${detail.fullName}` : ''}
            </div>
            {isSelf ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                This is you — you cannot deactivate or delete yourself.
              </div>
            ) : null}
          </div>
          {!isSelf ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                softDelete.reset();
                setConfirmDelete(true);
              }}
            >
              <Trash2 size={13} /> Delete
            </button>
          ) : null}
          {confirmDelete ? (
            <ConfirmDialog
              title={`Delete user ${detail.fullName ?? detail.email}?`}
              message="They will no longer be able to sign in."
              confirmLabel="Delete"
              pendingLabel="Deleting…"
              onConfirm={onDelete}
              onCancel={() => {
                softDelete.reset();
                setConfirmDelete(false);
              }}
              errorText={
                softDelete.isError
                  ? softDelete.error instanceof Error
                    ? softDelete.error.message
                    : 'Could not delete user. Try again.'
                  : null
              }
              elevated={false}
            />
          ) : null}
        </div>
        <div className="panel-body">
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
                <label className="form-label" htmlFor="email">
                  Email
                </label>
                <input id="email" className="innovic-input" value={detail.email} readOnly />
                <div className="form-help">Email cannot be changed here.</div>
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
                <label className="form-label">Department &amp; Access</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                  {dept ? (
                    <span style={{ color: dept.color, fontWeight: 700 }}>{dept.label}</span>
                  ) : (
                    <span className="text3">Not set</span>
                  )}
                  <span className={`badge ${roleBadgeClass(detail.role)}`}>
                    {roleLabel(detail.role)}
                  </span>
                  <Link to="/access-control" search={{ configure: detail.id }} className="btn btn-ghost btn-sm">
                    <Lock size={13} /> Change in Access Control
                  </Link>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              {submitError ? (
                <div style={{ marginBottom: 10 }}>
                  <Banner tone="error" role="alert">
                    {submitError}
                  </Banner>
                </div>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => exit.leave(goBack)}
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
                  Save Changes
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
            Set / Reset Password
          </div>
        </div>
        <div className="panel-body">
          <div className="text3" style={{ fontSize: 12, marginBottom: 10 }}>
            No email is sent — give the new password to the user.
          </div>
          {pwMsg ? (
            <div style={{ marginBottom: 10 }}>
              <Banner tone={pwMsg.kind === 'ok' ? 'success' : 'error'}>{pwMsg.text}</Banner>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-grp" style={{ minWidth: 240 }}>
              <label className="form-label" htmlFor="newPassword">
                New Password
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
              Set Password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
