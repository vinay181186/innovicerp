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
    if (event === 'SIGNED_OUT') {
      // Shared PCs (ADR-199): the next person must not inherit the last
      // person's table layouts or density. Every per-user preference query is
      // keyed ['me', …, userId]; drop them all, and the Compact class with them.
      queryClient.removeQueries({ queryKey: ['me'] });
      if (typeof document !== 'undefined') document.body.classList.remove('density-compact');
      // ADR-225 — and then throw the page away. The line above cleared the
      // PREFERENCES only; everything else the last person loaded was still
      // sitting in this tab, because sign-out is a pure SPA transition
      // (router.invalidate() + the route's redirect) and the QueryClient, the
      // Zustand store and every module-level cache survive it. On a shop-floor
      // PC the next person could be served the previous person's rows for the
      // whole gcTime window.
      //
      // `queryClient.clear()` alone would NOT be enough, which is why this is a
      // reload. It would leave: the open-pages tab bar (zustand `persist`,
      // 'innovic-open-tabs' — the next person sees which screens the last
      // person had open, by name), their starred/recent reports
      // ('innovic.reports.prefs.<userId>') AND the in-memory Map behind them,
      // the open top-nav menu ('innovic.topnav.open'), every table's sort and
      // filter state ('innovic.sf:*' / 'innovic.sf-server:*'), and the
      // heartbeat interval and visibility listeners installed once per page
      // load. Only a real navigation sheds all of it in one move, and it cannot
      // go stale the next time someone adds a store.
      //
      // The precedent for a hard navigation in this app is the error
      // boundary's recovery button, and nothing else — deliberately, because
      // the chrome hands every crumb and tab a real router link so normal
      // navigation never reloads the SPA. Sign-out is the other place it is
      // right: the session is over, and a one-second load costs nothing.
      clearLocalIdentityState();
      if (typeof window !== 'undefined') {
        window.location.assign('/login');
        return;
      }
    }
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
      void router.invalidate();
    }
  });
  return () => subscription.unsubscribe();
}

/**
 * ADR-225 — drop the per-person state this browser keeps OUTSIDE React Query,
 * before the sign-out reload.
 *
 * The reload alone discards everything held in memory, so this exists for the
 * keys that are PERSISTED and would therefore survive it. Each one is a thing
 * the next person at a shared PC must not inherit:
 *
 *   innovic-open-tabs            the open-pages tab bar — the names of the
 *                                screens the last person was working in
 *   innovic.reports.prefs.<id>   their starred and recent reports
 *   innovic.topnav.open          which module menu they had open
 *   innovic.sf:*                 every table's sort + filter choices
 *   innovic.sf-server:*          the server-side half of the same
 *
 * NOT touched: `innovic-erp-tabs` and `innovic-erp-tab` (the live-tab heartbeat
 * register — browser bookkeeping, not this person's data) and
 * `innovic-erp-e2e-keep-login` (Playwright's own flag; clearing it would log the
 * test suite out mid-run). Supabase's own auth keys are dropped by
 * `supabase.auth.signOut()` through the session storage adapter.
 *
 * Every access is wrapped: storage throws in a private window and when site
 * data is blocked, and a sign-out that fails because of it would be worse than
 * one that leaves a sort order behind.
 */
function clearLocalIdentityState(): void {
  const PREFIXES = ['innovic.sf:', 'innovic.sf-server:', 'innovic.reports.prefs.'];
  const EXACT = ['innovic-open-tabs', 'innovic.topnav.open'];
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (!store) continue;
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key === null) continue;
        if (EXACT.includes(key) || PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
    } catch {
      // Blocked or unavailable storage — the reload still sheds everything in
      // memory, which is the bulk of it.
    }
  }
}
