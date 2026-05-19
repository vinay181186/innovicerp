import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { NavBar } from '@/components/shared/nav-bar';
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

function AuthenticatedLayout(): React.JSX.Element {
  return (
    <div className="min-h-screen">
      <NavBar />
      <Outlet />
    </div>
  );
}
