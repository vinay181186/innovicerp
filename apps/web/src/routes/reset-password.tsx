import { zodResolver } from '@hookform/resolvers/zod';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { rootRoute } from './__root';

// Landing page for the password-reset email link. Supabase (detectSessionInUrl)
// processes the recovery token in the URL and establishes a short-lived session;
// we then let the user set a new password via auth.updateUser. If the link is
// expired/invalid (common when a mail scanner pre-opens the one-time link),
// Supabase appends error params to the hash instead of a session.
const schema = z
  .object({
    password: z.string().min(6, 'Password is at least 6 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });
type Form = z.infer<typeof schema>;

type Status = 'checking' | 'ready' | 'invalid' | 'done';

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/reset-password',
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Expired/invalid links arrive as #error=...&error_description=...
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('error')) {
      setStatus('invalid');
      setError(
        hash.get('error_description')?.replace(/\+/g, ' ') ??
          'The reset link is invalid or has expired.',
      );
      return;
    }

    const settle = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setStatus('ready');
        return;
      }
      // Wait briefly for the SDK to finish parsing the recovery token.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        if (s && !cancelled) {
          setStatus('ready');
          sub.subscription.unsubscribe();
        }
      });
      setTimeout(() => {
        if (cancelled) return;
        sub.subscription.unsubscribe();
        setStatus((cur) => (cur === 'ready' || cur === 'done' ? cur : 'invalid'));
        setError((e) => e ?? 'The reset link is invalid or has expired. Request a new one.');
      }, 8000);
    };
    void settle();

    return () => {
      cancelled = true;
    };
  }, []);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = async ({ password }: Form) => {
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError(err.message);
      return;
    }
    setStatus('done');
    setTimeout(() => navigate({ to: '/', replace: true }), 1200);
  };

  return (
    <main className="container max-w-md py-16">
      <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-6">
        {status === 'checking' ? (
          <div className="space-y-3 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Verifying your reset link&hellip;</p>
          </div>
        ) : status === 'invalid' ? (
          <div className="space-y-3 text-center">
            <h1 className="text-lg font-semibold text-destructive">Reset link problem</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <a className="text-sm underline underline-offset-4" href="/login">
              Back to sign in
            </a>
          </div>
        ) : status === 'done' ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h1 className="text-xl font-semibold">Password updated</h1>
            <p className="text-sm text-muted-foreground">Signing you in&hellip;</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
              <p className="text-sm text-muted-foreground">
                Enter a new password for your account.
              </p>
            </div>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  New password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('password')}
                />
                {form.formState.errors.password ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm" className="text-sm font-medium">
                  Confirm new password
                </label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirm')}
                />
                {form.formState.errors.confirm ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.confirm.message}
                  </p>
                ) : null}
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
                Update password
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
