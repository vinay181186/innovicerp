// Planning Dashboard (PL-3). Mirrors legacy renderPlanDashboard L9994.
// KPI tile strip + recent plans table. Plan creation + execute workflow
// land in PL-4 (SO/JW Planning).

import type { Plan, PlanStatus, PlanType } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePlanningDashboard } from '../api';

export const planningDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'planning-dashboard',
  component: PlanningDashboardPage,
});

const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: 'b-grey', label: 'In Planning' },
  planned: { cls: 'b-blue', label: 'Planned' },
  jc_created: { cls: 'b-cyan', label: 'JC Created' },
  pr_created: { cls: 'b-cyan', label: 'PR Created' },
  in_production: { cls: 'b-amber', label: 'In Production' },
  complete: { cls: 'b-green', label: 'Complete' },
  cancelled: { cls: 'b-grey', label: 'Cancelled' },
};

const TYPE_LABEL: Record<PlanType, { icon: string; label: string }> = {
  manufacture: { icon: '🏭', label: 'Manufacture' },
  direct_purchase: { icon: '🛒', label: 'Direct Purchase' },
  full_outsource: { icon: '📦', label: 'Full Outsource' },
  assembly: { icon: '🔧', label: 'Assembly' },
};

function PlanningDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = usePlanningDashboard();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📊 Planning Dashboard</div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading dashboard…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load planning dashboard'}
            </div>
          </div>
        </div>
      ) : data ? (
        <>
          <KpiStrip kpi={data.kpi} />
          <RecentPlansTable rows={data.recentPlans} />
        </>
      ) : null}
    </div>
  );
}

function KpiStrip({ kpi }: { kpi: { [k: string]: number } }): React.JSX.Element {
  const tiles: Array<{ label: string; val: number; color: string }> = [
    { label: 'Needs Planning', val: kpi['needsPlanning'] ?? 0, color: 'var(--amber2)' },
    { label: 'In Planning', val: kpi['inPlanning'] ?? 0, color: 'var(--text3)' },
    { label: 'Planned', val: kpi['planned'] ?? 0, color: 'var(--blue)' },
    { label: 'JC Created', val: kpi['jcCreated'] ?? 0, color: 'var(--cyan)' },
    { label: 'PR Created', val: kpi['prCreated'] ?? 0, color: 'var(--cyan)' },
    { label: 'In Production', val: kpi['inProduction'] ?? 0, color: 'var(--amber2)' },
    { label: 'Complete', val: kpi['complete'] ?? 0, color: 'var(--green2)' },
  ];
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div
        className="panel-body"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              background: 'var(--bg2)',
            }}
          >
            <div
              className="text3"
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 18,
                fontWeight: 700,
                color: t.color,
                marginTop: 2,
              }}
            >
              {t.val}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RecentPlanRow extends Plan {
  itemCode: string | null;
  itemName: string | null;
  opsCount: number;
}

function RecentPlansTable({ rows }: { rows: RecentPlanRow[] }): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            No plans yet. Plans are created from the SO/JW Planning workflow (PL-4).
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Recent plans ({rows.length})</div>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Plan #</th>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th>SO</th>
              <th className="td-right">Order Qty</th>
              <th className="td-right">Plan Qty</th>
              <th className="td-ctr">Ops</th>
              <th>Status</th>
              <th>Linked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PlanRow key={row.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanRow({ row }: { row: RecentPlanRow }): React.JSX.Element {
  const status = STATUS_BADGE[row.planStatus];
  const typeMeta = TYPE_LABEL[row.planType];
  return (
    <tr>
      <td>
        <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 600 }}>
          {row.code}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {row.planDate}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {typeMeta.icon} {typeMeta.label}
        </span>
      </td>
      <td>
        <div>{row.itemCode ?? row.itemCodeText ?? '—'}</div>
        {row.itemName ?? row.itemNameText ? (
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            {row.itemName ?? row.itemNameText}
          </div>
        ) : null}
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {row.soCodeText ?? '—'}
          {row.lineNo ? ` · L#${row.lineNo}` : ''}
        </span>
      </td>
      <td className="td-right">{row.orderQty}</td>
      <td className="td-right">{row.planQty}</td>
      <td className="td-ctr">{row.opsCount}</td>
      <td>
        <span className={`badge ${status.cls}`}>{status.label}</span>
      </td>
      <td>
        <Linked row={row} />
      </td>
    </tr>
  );
}

function Linked({ row }: { row: RecentPlanRow }): React.JSX.Element {
  const links: React.ReactNode[] = [];
  if (row.jcId) {
    links.push(
      <span key="jc" className="badge b-cyan" title="Linked Job Card">
        JC linked
      </span>,
    );
  }
  if (row.dpPrId) {
    links.push(
      <span key="dpp" className="badge b-amber" title="Direct-purchase PR">
        DP PR
      </span>,
    );
  }
  if (row.foPrId) {
    links.push(
      <span key="fop" className="badge b-amber" title="Full-outsource PR">
        FO PR
      </span>,
    );
  }
  if (row.foMatPrId) {
    links.push(
      <span key="fom" className="badge b-amber" title="FO material PR">
        FO Mat PR
      </span>,
    );
  }
  if (links.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 12 }}>
        —
      </span>
    );
  }
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{links}</div>;
}
