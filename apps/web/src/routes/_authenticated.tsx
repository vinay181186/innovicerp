import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';
import { OpenTabsBar } from '@/components/shared/open-tabs-bar';
import { TopNav } from '@/components/shared/top-nav';
import { supabase } from '@/lib/supabase';
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
  return (
    <div id="app-shell">
      <div id="main">
        <header id="app-header">
          <TopNav />
          <OpenTabsBar />
          <Breadcrumbs />
        </header>
        <div id="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
