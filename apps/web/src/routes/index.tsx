// Dashboard / home landing — ADR-264: one board with a left menu (My to-do ·
// Day Log · Approvals · the caller's departments) and a content area
// (modules/dashboard/components/home-page.tsx). The chosen view lives in the
// URL (`?view=`), so Back and a refresh keep it. Replaces the ADR-250 layout
// (Widgets / Customize modes, cue strip, right column).

import { createRoute } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { useCanOpen } from '@/components/shared/action-link';
import { useMarkTasksViewed } from '@/modules/tasks/api';
import { useHome } from '@/modules/dashboard/api';
import { HOME_VIEWS, type HomeView } from '@/modules/dashboard/home-views';
import { HomePage } from '@/modules/dashboard/components/home-page';
import { authenticatedRoute } from './_authenticated';

const homeSearchSchema = z.object({
  /** A bad value is dropped (→ My to-do), never an error page. */
  view: z.enum(HOME_VIEWS).optional().catch(undefined),
});

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  validateSearch: (search) => homeSearchSchema.parse(search),
  component: IndexPage,
});

function IndexPage(): React.JSX.Element {
  const search = indexRoute.useSearch();
  const navigate = indexRoute.useNavigate();
  const view: HomeView = search.view ?? 'todo';
  const { data: home } = useHome();
  const markViewed = useMarkTasksViewed();
  // Not for someone whose Task Board page is hidden (taskboard_view).
  const canTasks = useCanOpen()('/task-board');

  // Stamp the user's freshly-assigned tasks as viewed (legacy _markTasksViewed
  // on home render) — once per mount, and only AFTER the first home load has
  // rendered, so My to-do shows that load's unread marks instead of racing it.
  const marked = useRef(false);
  const loaded = home != null;
  useEffect(() => {
    if (!loaded || marked.current || !canTasks) return;
    marked.current = true;
    markViewed.mutate();
  }, [loaded, markViewed, canTasks]);

  return (
    <HomePage
      view={view}
      onView={(next, replace = false) =>
        void navigate({ search: { view: next === 'todo' ? undefined : next }, replace })
      }
    />
  );
}
