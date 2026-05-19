import { createRoute, Outlet, redirect } from '@tanstack/react-router';
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
function AuthenticatedLayout(): React.JSX.Element {
  return (
    <div id="app-shell">
      <Sidebar />
      <div id="main">
        <TopBar />
        <div id="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
