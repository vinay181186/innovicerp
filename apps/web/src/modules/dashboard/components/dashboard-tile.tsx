// Single dashboard tile (T-041c). Renders a clickable card with the count
// rendered large + an optional secondary metric. Severity drives the colour
// of the count + a left-edge accent stripe so the screen reads as a
// dashboard at a glance.

import type { DashboardTile as Tile } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';

const SEVERITY_STYLES: Record<Tile['severity'], { count: string; stripe: string; label: string }> =
  {
    ok: {
      count: 'text-green-700 dark:text-green-300',
      stripe: 'bg-green-500',
      label: 'caught up',
    },
    info: {
      count: 'text-foreground',
      stripe: 'bg-blue-500',
      label: '',
    },
    warning: {
      count: 'text-amber-700 dark:text-amber-300',
      stripe: 'bg-amber-500',
      label: '',
    },
    danger: {
      count: 'text-red-700 dark:text-red-300',
      stripe: 'bg-red-500',
      label: '',
    },
  };

export function DashboardTile(props: { tile: Tile }) {
  const { tile } = props;
  const styles = SEVERITY_STYLES[tile.severity];

  return (
    <Link
      to={tile.route}
      className="group relative flex h-full flex-col justify-between overflow-hidden rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent"
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${styles.stripe}`} aria-hidden />
      <div className="ml-2 space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {tile.title}
          </span>
          <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
        <div className={`font-mono text-3xl font-bold ${styles.count}`}>{tile.count}</div>
        {tile.secondary ? (
          <div className="text-xs text-muted-foreground">
            <span>{tile.secondary.label}: </span>
            <span className="font-mono font-semibold text-foreground">{tile.secondary.value}</span>
          </div>
        ) : tile.severity === 'ok' && styles.label ? (
          <div className="text-xs text-green-700 dark:text-green-300">{styles.label}</div>
        ) : null}
      </div>
      {tile.hint ? (
        <p className="ml-2 mt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
          {tile.hint}
        </p>
      ) : null}
    </Link>
  );
}
