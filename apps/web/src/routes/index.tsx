import { createRoute } from '@tanstack/react-router';
import { useSession } from '@/lib/session';
import { DashboardTilesGrid } from '@/modules/dashboard/components/dashboard-tiles-grid';
import { authenticatedRoute } from './_authenticated';

// Dashboard / landing — every authenticated page hangs off here.
// The big module-link grid that used to live here is now in the
// sidebar (apps/web/src/components/shared/sidebar.tsx). This page
// focuses on the welcome line + the role-filtered KPI tile grid
// (DashboardTilesGrid).

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  const { data: me, isLoading } = useSession();

  return (
    <div>
      <div className="section-hdr">
        {isLoading ? 'Loading…' : me ? `Welcome, ${me.email}` : 'Not signed in'}
      </div>
      <DashboardTilesGrid />
    </div>
  );
}
