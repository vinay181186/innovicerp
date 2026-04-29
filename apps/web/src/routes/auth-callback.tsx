import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { rootRoute } from './__root';

export const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // detectSessionInUrl=true on the supabase client auto-handles the magic-link
    // params. Wait for either an authenticated session or an explicit error.
    let cancelled = false;

    const settle = async () => {
      const {
        data: { session },
        error: getErr,
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (getErr) {
        setError(getErr.message);
        return;
      }
      if (session) {
        navigate({ to: '/', replace: true });
        return;
      }
      // Otherwise wait briefly for the SDK to finish processing.
      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        if (s) {
          sub.subscription.unsubscribe();
          if (!cancelled) navigate({ to: '/', replace: true });
        }
      });
      // If nothing happens in 8s, give up with an error.
      setTimeout(() => {
        if (cancelled) return;
        sub.subscription.unsubscribe();
        setError('Sign-in did not complete. The link may have expired.');
      }, 8000);
    };
    void settle();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="container max-w-md py-16">
      <div className="rounded-lg border bg-card p-8 text-card-foreground space-y-3 text-center">
        {error ? (
          <>
            <h1 className="text-lg font-semibold text-destructive">Sign-in failed</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <a className="text-sm underline underline-offset-4" href="/login">
              Try again
            </a>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Completing sign-in&hellip;</p>
          </>
        )}
      </div>
    </main>
  );
}
