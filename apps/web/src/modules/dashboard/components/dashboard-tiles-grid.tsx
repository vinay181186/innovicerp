// Grid wrapper around the dashboard tiles (T-041c + T-043 role filter).
// Single component so home + a future standalone /dashboard route can both
// use it without duplicating the loading/error/empty states. Tiles are
// already role-filtered server-side; this just renders whatever comes back.

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useDashboardKpis } from '../api';
import { DashboardTile } from './dashboard-tile';

export function DashboardTilesGrid() {
  const { data, isLoading, isError, error, isFetching } = useDashboardKpis();

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-card-foreground">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading KPIs…
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
        <div className="inline-flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {error instanceof Error ? error.message : 'Failed to load dashboard KPIs'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          At a glance
        </h2>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {isFetching ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              refreshing
            </span>
          ) : (
            <span>refreshed {new Date(data.generatedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </div>
      {data.tiles.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No KPI tiles configured for your role.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {data.tiles.map((tile) => (
            <DashboardTile key={tile.kind} tile={tile} />
          ))}
        </div>
      )}
    </div>
  );
}
