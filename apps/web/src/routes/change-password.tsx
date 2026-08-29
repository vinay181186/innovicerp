// In-app "Change Password" for a logged-in user (ADR-049 follow-up; closes the
// docs/ISSUES.md L1828 gap "🔑 Change Password — needs a Supabase updateUser
// modal"). Email-independent on purpose: the emailed "Forgot password?" flow
// needs custom SMTP (Resend + DNS) which is deferred, whereas this works today
// for everyone still on the shared initial password.
//
// Security: we re-authenticate with the CURRENT password first (Supabase's
// updateUser does not require it, but a logged-in-but-unattended session should
// not be able to silently rotate the password). This mirrors the legacy
// reauthenticateWithCredential + updatePassword pair.
//
// Chrome: this page lives INSIDE the authenticated app shell, so it uses the
// ERP theme tokens/components (panel / innovic-input / btn), not the shadcn card
// the logged-out /auth/reset-password screen uses.

import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { authenticatedRoute } from './_authenticated';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    password: z.string().min(6, 'New password must be at least 6 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'New passwords do not match',
    path: ['confirm'],
  })
  .refine((v) => v.password !== v.currentPassword, {
    message: 'New password must be different from the current one',
    path: ['password'],
  });
type Form = z.infer<typeof schema>;

export const changePasswordRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'change-password',
  component: ChangePasswordPage,
});

function ChangePasswordPage(): React.JSX.Element {
  const { data: me, isLoading } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', password: '', confirm: '' },
  });

  const onSubmit = async ({ currentPassword, password }: Form): Promise<void> => {
    setError(null);
    if (!me?.email) {
      setError('Your session has expired — sign in again.');
      return;
    }
    // 1. Verify the current password by re-authenticating this same account.
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: me.email,
      password: currentPassword,
    });
    if (reauthErr) {
      form.setError('currentPassword', { message: 'Current password is incorrect' });
      return;
    }
    // 2. Set the new password on the (now freshly re-authenticated) session.
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setDone(true);
    setTimeout(() => void navigate({ to: '/', replace: true }), 1400);
  };

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 440, margin: '0 auto' }}>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        <KeyRound size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Change Password
      </div>

      {done ? (
        <div className="panel" style={{ padding: 28, textAlign: 'center' }}>
          <CheckCircle2 size={40} style={{ color: 'var(--green)', margin: '0 auto 8px' }} />
          <div className="fw-700" style={{ fontSize: 16, marginBottom: 4 }}>
            Password updated
          </div>
          <div className="text3" style={{ fontSize: 12 }}>
            Your new password is active. Returning to the dashboard…
          </div>
        </div>
      ) : (
        <div className="panel" style={{ padding: 20 }}>
          <div className="text2" style={{ fontSize: 12, marginBottom: 14 }}>
            Signed in as <span className="fw-700">{me?.email ?? '—'}</span>. Enter your current
            password, then choose a new one.
          </div>
          <form onSubmit={form.handleSubmit((v) => void onSubmit(v))} style={{ display: 'grid', gap: 14 }}>
            <Field
              label="Current password"
              id="currentPassword"
              autoComplete="current-password"
              register={form.register('currentPassword')}
              error={form.formState.errors.currentPassword?.message}
            />
            <Field
              label="New password"
              id="password"
              autoComplete="new-password"
              register={form.register('password')}
              error={form.formState.errors.password?.message}
            />
            <Field
              label="Confirm new password"
              id="confirm"
              autoComplete="new-password"
              register={form.register('confirm')}
              error={form.formState.errors.confirm?.message}
            />

            {error ? (
              <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <Loader2 className="inline h-3 w-3 animate-spin" />
                ) : null}{' '}
                Update password
              </button>
              <Link to="/" className="btn btn-ghost btn-sm">
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field(props: {
  label: string;
  id: string;
  autoComplete: string;
  register: ReturnType<ReturnType<typeof useForm<Form>>['register']>;
  error: string | undefined;
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label htmlFor={props.id} className="text2" style={{ fontSize: 12, fontWeight: 600 }}>
        {props.label}
      </label>
      <input
        id={props.id}
        type="password"
        autoComplete={props.autoComplete}
        className="innovic-input"
        style={{ fontSize: 13 }}
        {...props.register}
      />
      {props.error ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{props.error}</span> : null}
    </div>
  );
}
