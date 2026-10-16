import { meetsPageRule, missingRightText, pageRuleFor } from '@innovic/shared';
import { createRoute, Outlet, redirect, useMatches } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';
import { installCellOverflowTitles } from '@/components/shared/cell-overflow-title';
import { OpenTabsBar } from '@/components/shared/open-tabs-bar';
import { TopNav } from '@/components/shared/top-nav';
import { useMyAccess } from '@/lib/access-control';
import { LiveUpdatesProvider } from '@/lib/live-updates/live-updates-provider';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { useUiSettings } from '@/lib/use-ui-settings';
import { SortFilterScope } from '@/ui/data/sort-filter/scope';
import { ToastProvider } from '@/ui/feedback';
import { PageState } from '@/ui/layout/PageState';
import { rootRoute } from './__root';

export const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authenticated',
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      throw redirect({ to: '/login' });
    }
  },
  component: AuthenticatedLayout,
});

// Innovic shell (2026-09-21): ONE header band across the top, var(--topbar-height)
// tall — logo, the modules as dropdown menus, search, sign-out — then the
// open-page tabs, the breadcrumb, and the scrolling content area below. The
// 220px left sidebar and the separate top bar it replaced are gone; the module
// / page list they drew lives on in components/shared/nav-sections.ts.
// (The band was 54px until the Phase 2 token pass moved --topbar-height to
// 48px; nothing in this file encodes the number — tokens.css owns it.)
//
// All three bands are thin adapters over the ui/ primitives as of Phase 3:
// TopNav composes ui/core's Icon + SyncDot, OpenTabsBar composes
// ui/navigation/PageTabs and Breadcrumbs composes ui/navigation/Breadcrumbs,
// each handing the primitive `renderLink={(p) => <Link {...p} />}` so every
// crumb and tab stays a real router link and nothing hard-reloads the SPA.
//
// The breadcrumb sits OUTSIDE #content on purpose. #content is the scroll
// container (innovic-theme.css: flex:1 + overflow-y:auto), so a trail rendered
// inside it scrolls away with the rows. Out here it is fixed chrome alongside
// the topbar — and it needs no `position: sticky`, which matters because list
// pages already pin their own toolbar band at `top: 0` (e.g.
// sales-orders/routes/list.tsx): a second element at `top: 0` would collide
// with it, and the trail wraps to two lines when narrow so no fixed offset
// would hold. Keeping it out of the scroller sidesteps both.
//
// The three chrome bands are wrapped in <header id="app-header"> so the header
// is ONE surface: the wrapper carries the background for all three bands and
// the page's top gutter, and the tab strip's border-bottom is the chrome's one
// and only hairline — no band below it may add a second. Loose bands each
// painted their own colour, and the gutter used to be #content's padding-top —
// i.e. inside the scroller, page-coloured, and a gutter's worth of it showed
// between the chrome and whatever a list pinned at `top: 0`. See the
// #app-header block in innovic-theme.css for the full reasoning.
function AuthenticatedLayout(): React.JSX.Element {
  useEffect(() => installCellOverflowTitles(), []); // ADR-199: tooltip on ellipsised table cells
  useUiSettings(); // ADR-199: the user's Comfortable/Compact choice reaches EVERY table
  // ADR-226 — ToastProvider belongs here, once, around the whole shell.
  // ui/feedback/Toast.tsx has been written and token-styled since Phase 3, with
  // a 3000 ms auto-dismiss and a close X, but NOTHING mounted its provider
  // outside the /__ui-kit demo — so `useToast()` threw everywhere, and two
  // places carried their own copy instead (so-status-detail.tsx wraps itself;
  // TableToolbar hand-rolls a timer and therefore has no X). The edit-conflict
  // notice needs it on every edit screen, and a toast is chrome rather than
  // page content, so it belongs with TopNav / OpenTabsBar / Breadcrumbs. It is
  // OUTSIDE #content because #content is the scroll container — a toast
  // rendered inside it would scroll away with the rows.
  // ADR-230 — live updates start once per signed-in tab, around the whole shell,
  // so the top-bar marker and every screen's record watch share one connection.
  return (
    <ToastProvider>
      <LiveUpdatesProvider>
        <div id="app-shell">
          <div id="main">
            <header id="app-header">
              <TopNav />
              <OpenTabsBar />
              <Breadcrumbs />
            </header>
            <div id="content">
              <SortFilterScope>
                <PageAccessGuard />
              </SortFilterScope>
            </div>
          </div>
        </div>
      </LiveUpdatesProvider>
    </ToastProvider>
  );
}

// ADR-234 — the ONE route guard. Every page under the shell is checked here
// against its rule in PAGE_ACCESS (packages/shared/src/lib/page-access.ts),
// keyed on the matched route's pattern ('/production-orders/$id/edit'), so a
// typed URL is refused with the same rule the menu and every next-step link
// use. The per-page guards inside the modules stay; this sits in front of them.
//
// While the session or the access matrix is still loading, a non-open page
// renders the loading state rather than a refusal, so nobody sees "no access"
// flash before their ticks arrive. Super Admin (role admin or Full Access)
// passes everything; an unknown route pattern is refused (fail closed) except
// for Super Admin.
function PageAccessGuard(): React.JSX.Element {
  const fullPath = useMatches({
    select: (ms) => (ms.length > 0 ? String(ms[ms.length - 1]!.fullPath ?? '') : ''),
  });
  const { data: me, isPending: mePending } = useSession();
  const { data: eff, isPending: effPending, isError: effError } = useMyAccess();

  const rule = pageRuleFor(fullPath || '/');
  if (rule && 'open' in rule) return <Outlet />;

  if (mePending || (effPending && !effError)) return <PageState as="page" state="loading" />;
  const isSuperAdmin = me?.role === 'admin' || !!eff?.fullAccess;
  if (isSuperAdmin) return <Outlet />;
  // Access could not be read (network / 500): let the page load as it did
  // before this guard existed — every save is still checked by the server.
  if (effError) return <Outlet />;
  if (!rule || !meetsPageRule(eff, false, rule)) {
    return <PageState as="page" state="noaccess" message={missingRightText(rule)} />;
  }
  return <Outlet />;
}
