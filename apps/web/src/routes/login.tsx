import { zodResolver } from '@hookform/resolvers/zod';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RESET_LINK_VALID_MINUTES, type ForgotPasswordResponse } from '@innovic/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { authErrorMessage } from './auth-error-message';
import { rootRoute } from './__root';

const emailSchema = z.object({
  email: z.string().email('Please enter a valid email'),
});
type EmailForm = z.infer<typeof emailSchema>;

const passwordSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password is at least 6 characters'),
});
type PasswordForm = z.infer<typeof passwordSchema>;

type Mode = 'password' | 'reset';

// `?reset=done` / `done-nomail` — the reset page lands here after a successful password change
// (it signs every session out first, so the user must sign in again); `done-nomail` means the
// API could not send the confirmation email, so the panel does not claim one. `?mode=reset` — open straight
// on the "send me a reset link" form (the "Request a new link" button on an expired link).
const loginSearchSchema = z.object({
  reset: z.enum(['done', 'done-nomail']).optional().catch(undefined),
  mode: z.enum(['reset']).optional().catch(undefined),
});

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

function LoginPage() {
  const search = loginRoute.useSearch();
  const [mode, setMode] = useState<Mode>(search.mode === 'reset' ? 'reset' : 'password');
  // Captured once at mount so the panel survives the URL clean-up below.
  const [resetDone] = useState(search.reset);
  const [sent, setSent] = useState<{ email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Drop `?reset=done` from the address bar once shown, so a refresh does not repeat it.
  useEffect(() => {
    if (search.reset) {
      void navigate({ to: '/login', search: {}, replace: true });
    }
  }, [search.reset, navigate]);

  if (sent) {
    return (
      <main className="container max-w-md py-16">
        <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-3 text-center">
          <Mail className="mx-auto h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Check your inbox</h1>
          {/* Worded so it never confirms that an account exists for the address — the API
              answers the same way either way, and so must we. */}
          <p className="text-sm text-muted-foreground">
            If an account exists for{' '}
            <span className="font-medium text-foreground">{sent.email}</span>, a reset link is on
            its way. Check your inbox (and spam), then click it to choose a new password.
          </p>
          <p className="text-xs text-muted-foreground">
            The link is valid for {RESET_LINK_VALID_MINUTES} minutes and works once. Check Spam if
            you don&rsquo;t see it.
          </p>
          <p className="text-xs text-muted-foreground">
            Some mail scanners can expire one-time links before you click. Ask an admin to set your
            password directly if it keeps failing.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSent(null)}>
            Use a different email
          </Button>
        </div>
      </main>
    );
  }

  const subtitle =
    mode === 'reset'
      ? "Enter your email and we'll send you a link to reset your password."
      : 'Enter your email and password.';

  return (
    <main className="container max-w-md py-16">
      <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === 'reset' ? 'Reset your password' : 'Sign in to Innovic ERP'}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        {resetDone && mode === 'password' ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-md border p-3 text-sm"
            style={{
              borderColor: 'var(--green)',
              background: 'var(--green3)',
              color: 'var(--green2)',
            }}
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Password changed. Sign in with your new password.
              {resetDone === 'done' ? ' A confirmation email has been sent to you.' : null}
            </p>
          </div>
        ) : null}

        {mode === 'reset' ? (
          <ResetRequestForm
            onSent={(email) => setSent({ email })}
            onError={setError}
            onClearError={() => setError(null)}
            error={error}
          />
        ) : (
          <PasswordForm
            onSuccess={() => navigate({ to: '/', replace: true })}
            onForgot={() => {
              setError(null);
              setMode('reset');
            }}
            onError={setError}
            onClearError={() => setError(null)}
            error={error}
          />
        )}

        {mode === 'reset' ? (
          <div className="text-center text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setError(null);
                setMode('password');
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ResetRequestForm(props: {
  onSent: (email: string) => void;
  onError: (msg: string) => void;
  onClearError: () => void;
  error: string | null;
}) {
  const form = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async ({ email }: EmailForm) => {
    props.onClearError();
    // The reset email is sent by OUR API, not by supabase-js from the browser.
    // `supabase.auth.resetPasswordForEmail` used Supabase's built-in mailer, which never
    // delivered to staff addresses on the test project (traced 2026-09-19). The API
    // generates the recovery link with the admin API and emails it through Resend. It
    // always answers 200 with the same body whether or not the address has an account,
    // so this form cannot be used to find out which emails are registered.
    try {
      await apiFetch<ForgotPasswordResponse>('/auth/forgot-password', {
        method: 'POST',
        json: { email },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        props.onError(
          err.code === 'network_error'
            ? 'Could not reach the server. Please try again.'
            : err.message,
        );
        return;
      }
      props.onError('That request could not be completed. Please try again.');
      return;
    }
    props.onSent(email);
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}

      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Send reset link
      </Button>
    </form>
  );
}

function PasswordForm(props: {
  onSuccess: () => void;
  onForgot: () => void;
  onError: (msg: string) => void;
  onClearError: () => void;
  error: string | null;
}) {
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async ({ email, password }: PasswordForm) => {
    props.onClearError();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      props.onError(authErrorMessage(err, 'sign-in'));
      return;
    }
    props.onSuccess();
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <button
            type="button"
            className="text-xs underline underline-offset-4"
            style={{ color: 'var(--blue)' }}
            onClick={props.onForgot}
          >
            Forgot password?
          </button>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>

      {props.error ? <p className="text-sm text-destructive">{props.error}</p> : null}

      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
