// Planning KPI strip — the former Planning Dashboard tiles, folded onto the
// Plans list as its filter bar (tile-as-filter). Status tiles drive the Plans
// `status` URL filter; the red "Needs Planning" tile switches the body to the
// unplanned-SO-lines table. Mirrors legacy renderPlanDashboard L10014–10020.

import type { PlanStatus } from '@innovic/shared';

type StatusTile = { status: PlanStatus; label: string; color: string; kpiKey: string };

const STATUS_TILES: StatusTile[] = [
  { status: 'in_planning', label: 'In Planning', color: 'var(--amber)', kpiKey: 'inPlanning' },
  { status: 'planned', label: 'Planned (Ready)', color: 'var(--blue)', kpiKey: 'planned' },
  { status: 'jc_created', label: 'JC Created', color: 'var(--cyan)', kpiKey: 'jcCreated' },
  { status: 'pr_created', label: 'PR Created (Buy)', color: '#8b5cf6', kpiKey: 'prCreated' },
  { status: 'in_production', label: 'In Production', color: 'var(--cyan)', kpiKey: 'inProduction' },
  { status: 'complete', label: 'Complete', color: 'var(--green)', kpiKey: 'complete' },
];

function Tile({
  label,
  color,
  value,
  active,
  onClick,
}: {
  label: string;
  color: string;
  value: number;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        border: '1px solid var(--border)',
        borderTop: `3px solid ${color}`,
        borderRadius: 6,
        padding: '8px 10px',
        background: 'var(--bg2)',
        boxShadow: active ? `0 0 0 2px ${color}` : undefined,
        transition: 'box-shadow .15s',
      }}
    >
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

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
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        marginBottom: 16,
      }}
    >
      <Tile
        label="Needs Planning"
        color="var(--red)"
        value={kpi['needsPlanning'] ?? 0}
        active={needsPlanning}
        onClick={onSelectNeedsPlanning}
      />
      {STATUS_TILES.map((t) => (
        <Tile
          key={t.status}
          label={t.label}
          color={t.color}
          value={kpi[t.kpiKey] ?? 0}
          active={!needsPlanning && activeStatus === t.status}
          // Toggle: click the active tile again to clear the status filter.
          onClick={() => onSelectStatus(activeStatus === t.status && !needsPlanning ? undefined : t.status)}
        />
      ))}
    </div>
  );
}
