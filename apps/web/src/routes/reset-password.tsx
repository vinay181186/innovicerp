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

// Landing page for the password-reset email link. Two link shapes arrive here:
//
//  1. The link our API generates (admin generateLink, sent via Resend — or via Supabase's
//     mailer as the API's fallback; both use the admin client's implicit flow, see
//     packages/shared/src/schemas/auth-recovery.ts). Supabase verifies the token and
//     redirects with `#access_token=…&refresh_token=…&type=recovery`. Our client runs in
//     PKCE mode (lib/supabase.ts — magic links depend on it) and supabase-js REFUSES to
//     auto-parse that implicit-style hash ("Not a valid PKCE flow url"), so we read the
//     tokens ourselves and call setSession.
//  2. A PKCE link that lands as `?code=…` — only from a reset sent from the Supabase
//     dashboard or an old email. supabase-js (detectSessionInUrl) usually exchanges the
//     code itself during start-up when the PKCE verifier is in this browser's storage,
//     so we check for a session first and only exchange by hand if none exists. A
//     verifier that is missing (link opened in a different browser) is the real reason
//     the exchange fails.
//
// If the link is expired/invalid (common when a mail scanner pre-opens the one-time
// link), Supabase puts error params in the hash OR the query string instead.
// Once a session exists we let the user set a new password via auth.updateUser.
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

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    const param = (key: string) => hash.get(key) ?? query.get(key);

    // (a) Expired/invalid links arrive with error params — in the hash or the query string,
    // depending on which Supabase path produced them.
    if (param('error') || param('error_code')) {
      setStatus('invalid');
      setError(
        param('error_code') === 'otp_expired'
          ? 'This reset link has expired or was already used. Request a new one from the sign-in page.'
          : (param('error_description')?.replace(/\+/g, ' ') ??
              'The reset link is invalid or has expired.'),
      );
      return;
    }

    // (b) Server-generated recovery link: tokens are in the hash. Set the session by hand.
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const hashType = hash.get('type');
    if (accessToken && refreshToken && (!hashType || hashType === 'recovery')) {
      const applyTokens = async () => {
        const { error: err } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (cancelled) return;
        if (err) {
          setStatus('invalid');
          setError(err.message || 'The reset link is invalid or has expired.');
          return;
        }
        // Drop the tokens from the address bar so a refresh does not replay them.
        window.history.replaceState(null, '', window.location.pathname);
        setStatus('ready');
      };
      void applyTokens();
      return () => {
        cancelled = true;
      };
    }

    // (c) PKCE link (`?code=`): the SDK may already have exchanged it during its own
    // initialisation, in which case a second exchange throws "code verifier missing"
    // even though a valid session exists. So look for a session first, exchange only if
    // there is none, and re-check once more before calling the link bad.
    const code = query.get('code');
    if (code) {
      const hasSession = async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        return !!session;
      };
      const exchange = async () => {
        let ok = await hasSession();
        if (cancelled) return;
        if (!ok) {
          const { error: err } = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          ok = !err || (await hasSession());
          if (cancelled) return;
        }
        if (!ok) {
          setStatus('invalid');
          setError(
            'This link must be opened in the same browser you requested it from. Request a new one from the sign-in page.',
          );
          return;
        }
        window.history.replaceState(null, '', window.location.pathname);
        setStatus('ready');
      };
      void exchange();
      return () => {
        cancelled = true;
      };
    }

    // (d) Nothing recognisable in the URL: fall back to whatever session the SDK has or
    // is about to establish, with a timeout so the page never spins forever.
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
      setError(
        /same password/i.test(err.message)
          ? 'Choose a password different from your current one.'
          : err.message,
      );
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
            <div className="text-center text-sm">
              <a className="text-muted-foreground underline-offset-4 hover:underline" href="/login">
                Back to sign in
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
