// Dashboard / home landing — mirror of legacy renderHome (L2486). Role-aware
// (admin / operator / specialist) with Alerts, Widgets and Customize modes, a
// My Work panel, and a greeting header. Replaces the old KPI-tiles-only page.

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMarkTasksViewed } from '@/modules/tasks/api';
import { dashboardKeys, useHome } from '@/modules/dashboard/api';
import { HomeAdmin } from '@/modules/dashboard/components/home-admin';
import { HomeAlerts } from '@/modules/dashboard/components/home-alerts';
import { HomeCustomize } from '@/modules/dashboard/components/home-customize';
import { HomeOperator } from '@/modules/dashboard/components/home-operator';
import { HomeSpecialist } from '@/modules/dashboard/components/home-specialist';
import { HomeWidgets } from '@/modules/dashboard/components/home-widgets';
import { MyWorkPanel } from '@/modules/dashboard/components/my-work-panel';
import { authenticatedRoute } from './_authenticated';

export const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: IndexPage,
});

type Mode = 'home' | 'alerts' | 'widgets' | 'customize';

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
    return <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>{error instanceof Error ? error.message : 'Failed to load'}</div>;
  }

  const greetCap = home.greetingPart.charAt(0).toUpperCase() + home.greetingPart.slice(1);
  const quickLinkPages = home.quickLinks;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Good {greetCap}, {home.userName}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{home.dateLabel} · <b style={{ color: 'var(--text2)' }}>{home.role}</b></div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {mode === 'alerts' ? (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setMode('home')}>📊 Overview</button>
          ) : (
            <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setMode('alerts')}>🔔 Alerts</button>
          )}
          <button type="button" className={`btn btn-ghost ${mode === 'widgets' ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setMode(mode === 'widgets' ? 'home' : 'widgets')}>📦 Widgets</button>
          <button type="button" className={`btn btn-ghost ${mode === 'customize' ? 'active' : ''}`} style={{ fontSize: 11 }} onClick={() => setMode(mode === 'customize' ? 'home' : 'customize')}>⚙ Customize</button>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 11 }} title="Refresh" onClick={() => void qc.invalidateQueries({ queryKey: dashboardKeys.all })}>🔄</button>
        </div>
      </div>

      {mode === 'customize' ? (
        <HomeCustomize onClose={() => setMode('home')} />
      ) : mode === 'widgets' ? (
        <HomeWidgets quickLinkPages={quickLinkPages} />
      ) : mode === 'alerts' ? (
        <HomeAlerts quickLinkPages={quickLinkPages} />
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
