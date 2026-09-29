// Dashboard / home landing — mirror of legacy renderHome (L2486). Role-aware
// (admin / operator / specialist) with Widgets and Customize modes, a
// My Work panel, and a greeting header. Replaces the old KPI-tiles-only page.

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMarkTasksViewed } from '@/modules/tasks/api';
import { dashboardKeys, useHome } from '@/modules/dashboard/api';
import { HomeAdmin } from '@/modules/dashboard/components/home-admin';
import { HomeCustomize } from '@/modules/dashboard/components/home-customize';
import { HomeOperator } from '@/modules/dashboard/components/home-operator';
import { HomeSpecialist } from '@/modules/dashboard/components/home-specialist';
import { HomeWidgets } from '@/modules/dashboard/components/home-widgets';
import { MyWorkPanel } from '@/modules/dashboard/components/my-work-panel';
import { authenticatedRoute } from './_authenticated';
import { roleLabel } from '@/lib/role-label';

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: IndexPage,
});

// No Alerts mode: it repeated Tasks & Alerts › Alerts one click away.
type Mode = 'home' | 'widgets' | 'customize';

function IndexPage(): React.JSX.Element {
  const { data: home, isLoading, isError, error } = useHome();
  const [mode, setMode] = useState<Mode>('home');
  const qc = useQueryClient();
  const markViewed = useMarkTasksViewed();

  // Stamp the current user's freshly-assigned tasks as viewed (legacy
  // _markTasksViewed on home render), once on mount.
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    markViewed.mutate();
  }, [markViewed]);

  if (isLoading) {
    return <div className="empty-state" style={{ padding: 40 }}><Loader2 className="inline h-4 w-4 animate-spin" /> Loading dashboard…</div>;
  }
  if (isError || !home) {
    return <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Could not load dashboard. Try again.'}</div>;
  }

  const greetCap = home.greetingPart.charAt(0).toUpperCase() + home.greetingPart.slice(1);
  const quickLinkPages = home.quickLinks;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          {/* The page had no <h1> at all — the greeting was a 19px bold <div>, so
              the dashboard presented no heading outline to a screen reader. */}
          <h1 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>
            Good {greetCap}, {home.userName}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            {home.dateLabel} · <b style={{ color: 'var(--text2)' }}>{roleLabel(home.role)}</b>
          </div>
        </div>
        {/* These switch the page's whole content, so they are a tab set in
            behaviour if not in markup. aria-pressed says which one is on —
            previously the active state was colour only (the `active` class). */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-ghost ${mode === 'widgets' ? 'active' : ''}`}
            style={{ fontSize: 11 }}
            aria-pressed={mode === 'widgets'}
            onClick={() => setMode(mode === 'widgets' ? 'home' : 'widgets')}
          >
            Widgets
          </button>
          <button
            type="button"
            className={`btn btn-ghost ${mode === 'customize' ? 'active' : ''}`}
            style={{ fontSize: 11 }}
            aria-pressed={mode === 'customize'}
            onClick={() => setMode(mode === 'customize' ? 'home' : 'customize')}
          >
            Customize
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11 }}
            aria-label="Refresh dashboard"
            onClick={() => void qc.invalidateQueries({ queryKey: dashboardKeys.all })}
          >
            Refresh
          </button>
        </div>
      </div>

      {mode === 'customize' ? (
        <HomeCustomize onClose={() => setMode('home')} />
      ) : mode === 'widgets' ? (
        <HomeWidgets quickLinkPages={quickLinkPages} />
      ) : (
        <>
          <MyWorkPanel mode={home.layout === 'operator' ? 'strip' : 'full'} />
          {home.layout === 'operator' ? (
            <HomeOperator home={home} />
          ) : home.layout === 'specialist' ? (
            <HomeSpecialist home={home} />
          ) : (
            <HomeAdmin home={home} />
          )}
        </>
      )}
    </div>
  );
}
