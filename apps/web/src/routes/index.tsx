// Dashboard / home landing — ADR-250: one per-person home for every user
// (modules/dashboard/components/home-page.tsx), with the Widgets and Customize
// modes. Replaces the admin / operator / specialist layouts (ADR-044).

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import type { HomeScope } from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMarkTasksViewed } from '@/modules/tasks/api';
import { dashboardKeys, useHome } from '@/modules/dashboard/api';
import { HomePage } from '@/modules/dashboard/components/home-page';
import { authenticatedRoute } from './_authenticated';

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  // My department / Mine — the server filters rows and counts for the scope.
  const [scope, setScope] = useState<HomeScope>('dept');
  const { data: home, isLoading, isError, error, dataUpdatedAt } = useHome(scope);
  const qc = useQueryClient();
  const markViewed = useMarkTasksViewed();

  // Stamp the current user's freshly-assigned tasks as viewed (legacy
  // _markTasksViewed on home render) — once per mount, and only AFTER the first
  // successful home load has rendered, so My to-do shows that load's unread
  // marks instead of racing the stamp.
  const marked = useRef(false);
  const loaded = home != null;
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    markViewed.mutate();
  }, [loaded, markViewed]);

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading dashboard…
      </div>
    );
  }
  if (isError || !home) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Could not load dashboard. Try again.'}
      </div>
    );
  }

  return (
    <HomePage
      home={home}
      scope={scope}
      onScope={setScope}
      updatedAt={dataUpdatedAt}
      onRefresh={() => void qc.invalidateQueries({ queryKey: dashboardKeys.all })}
    />
  );
}
