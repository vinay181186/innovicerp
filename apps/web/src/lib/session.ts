import type { MeResponse } from '@innovic/shared';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { apiFetch } from './api';
import { setSentryUser } from './sentry';
import { supabase } from './supabase';

export const sessionQueryKey = ['session', 'me'] as const;

export function useSession() {
  return useQuery<MeResponse | null>({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setSentryUser(null);
        return null;
      }
      // Fetches /me from API to get { id, email, companyId, role, isActive }.
      // The auth plugin reads the bearer token, attaches request.user, and the route returns it.
      const me = await apiFetch<MeResponse>('/me');
      setSentryUser(me);
      return me;
    },
    staleTime: 60_000,
  });
}

export async function signOut() {
  await supabase.auth.signOut();
  // The onAuthStateChange listener (registered in main.tsx) invalidates both
  // the session query and the router, which re-runs the _authenticated route's
  // beforeLoad and redirects to /login.
}

export function setupAuthListener(queryClient: QueryClient, router: AnyRouter): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event) => {
    queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      void router.invalidate();
    }
  });
  return () => subscription.unsubscribe();
}
