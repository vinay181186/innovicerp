// Planning KPI strip — the former Planning Dashboard tiles, folded onto the
// Plans list as its filter bar (tile-as-filter). Status tiles drive the Plans
// `status` URL filter; the red "Needs Planning" tile switches the body to the
// unplanned-SO-lines table. Mirrors legacy renderPlanDashboard L10014–10020.
//
// PHASE 4 — this file used to draw its own tile: a bordered card with a 3px
// coloured top edge, its own radius and padding, and a 2px coloured ring when
// active. That was a THIRD count design beside the StatStrip and the legacy KPI
// card, and it is the one ui/data/StatStrip.tsx names as retired. The tiles are
// now one <StatStrip>: label over number, hairline dividers, and the active
// filter marked by a coloured underline rather than a ring around the cell.
//
// The component keeps its own name, props, tiles, colours, counts and toggle —
// only what draws them changed. `#8b5cf6` became var(--purple), the token that
// same violet already has.

import type { PlanStatus } from '@innovic/shared';
import { StatStrip, type StatStripItem } from '@/ui/data';

type StatusTile = { status: PlanStatus; label: string; color: string; kpiKey: string };

const STATUS_TILES: StatusTile[] = [
  { status: 'in_planning', label: 'In Planning', color: 'var(--amber)', kpiKey: 'inPlanning' },
  { status: 'planned', label: 'Planned (Ready)', color: 'var(--blue)', kpiKey: 'planned' },
  { status: 'jc_created', label: 'JC Created', color: 'var(--cyan)', kpiKey: 'jcCreated' },
  { status: 'pr_created', label: 'PR Created (Buy)', color: 'var(--purple)', kpiKey: 'prCreated' },
  { status: 'in_production', label: 'In Production', color: 'var(--cyan)', kpiKey: 'inProduction' },
  { status: 'complete', label: 'Completed', color: 'var(--green)', kpiKey: 'complete' },
];

export function PlanningKpiStrip({
  kpi,
  activeStatus,
  needsPlanning,
  onSelectStatus,
  onSelectNeedsPlanning,
}: {
  kpi: Record<string, number>;
  activeStatus: PlanStatus | undefined;
  needsPlanning: boolean;
  onSelectStatus: (s: PlanStatus | undefined) => void;
  onSelectNeedsPlanning: () => void;
}): React.JSX.Element {
  const items: StatStripItem[] = [
    {
      key: 'needsPlanning',
      label: 'Needs Planning',
      count: kpi['needsPlanning'] ?? 0,
      color: 'var(--red)',
      active: needsPlanning,
      onClick: onSelectNeedsPlanning,
    },
    ...STATUS_TILES.map((t) => ({
      key: t.status,
      label: t.label,
      count: kpi[t.kpiKey] ?? 0,
      color: t.color,
      active: !needsPlanning && activeStatus === t.status,
      // Toggle: click the active tile again to clear the status filter.
      onClick: (): void =>
        onSelectStatus(activeStatus === t.status && !needsPlanning ? undefined : t.status),
    })),
  ];
  return <StatStrip items={items} />;
}
