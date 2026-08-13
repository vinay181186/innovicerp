import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { Breadcrumbs } from '@/components/shared/breadcrumbs';
import { OpenTabsBar } from '@/components/shared/open-tabs-bar';
import { Sidebar } from '@/components/shared/sidebar';
import { TopBar } from '@/components/shared/topbar';
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

// Innovic shell: 220px sidebar on the left, 54px topbar at the top of
// the content column, scrolling content area below. Mirrors the legacy
// HTML's #app / #sidebar / #main / #topbar / #content structure (see
// legacy/InnovicERP_*.html lines 50-55) — class IDs preserved so the
// CSS in src/styles/innovic-theme.css applies.
//
// The breadcrumb sits OUTSIDE #content on purpose. #content is the scroll
// container (innovic-theme.css: flex:1 + overflow-y:auto), so a trail rendered
// inside it scrolls away with the rows. Out here it is fixed chrome alongside
// the topbar — and it needs no `position: sticky`, which matters because list
// pages already pin their own toolbar band at `top: 0` (e.g.
// sales-orders/routes/list.tsx): a second element at `top: 0` would collide
// with it, and the trail wraps to two lines when narrow so no fixed offset
// would hold. Keeping it out of the scroller sidesteps both.
function AuthenticatedLayout(): React.JSX.Element {
  return (
    <div id="app-shell">
      <Sidebar />
      <div id="main">
        <TopBar />
        <Breadcrumbs />
        <OpenTabsBar />
        <div id="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
