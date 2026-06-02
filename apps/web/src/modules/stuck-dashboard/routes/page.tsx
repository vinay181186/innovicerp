// Stuck Activity Dashboard — mirror of legacy renderStuckDashboard (L18017).
//
// Flags SO phases that have run past their day threshold, grouped by stage and
// sorted by most-over-threshold. Read-only. Thresholds ship as constants for
// v1 (legacy had an editable config; no config store yet).

import type { StuckDashboardResponse, StuckItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';

export const stuckDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stuck-dashboard',
  component: StuckDashboardPage,
});

function overColor(over: number): string {
  return over > 10 ? '#7f1d1d' : over > 5 ? '#b91c1c' : '#ea580c';
}

function StuckDashboardPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<StuckDashboardResponse>({
    queryKey: ['stuck-dashboard'],
    queryFn: () => apiFetch<StuckDashboardResponse>('/stuck-dashboard'),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  // Group by stage, preserving the global most-over-threshold ordering within
  // each group; order groups by size (legacy L18130).
  const grouped = new Map<string, StuckItem[]>();
  for (const it of data.items) {
    const arr = grouped.get(it.stage);
    if (arr) arr.push(it);
    else grouped.set(it.stage, [it]);
  }
  const stageOrder = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <div className="section-hdr">⚠ Stuck Activity Dashboard</div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          margin: '12px 0 16px',
        }}
      >
        <Tile label="Total Stuck" value={data.summary.totalStuck} color="var(--amber)" />
        <Tile label="Critical (>5d over)" value={data.summary.criticalStuck} color="var(--red)" />
        <Tile label="Stages Affected" value={data.summary.stagesAffected} color="var(--blue)" />
      </div>

      {data.summary.totalStuck === 0 ? (
        <div
          className="empty-state"
          style={{
            padding: 60,
            color: 'var(--green)',
            background: 'rgba(34,197,94,0.05)',
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>
            All activities on track
          </div>
          <div className="text3" style={{ fontSize: 12, marginTop: 4 }}>
            No activities are stuck beyond threshold
          </div>
        </div>
      ) : (
        stageOrder.map(([stage, items]) => {
          const color = items[0]!.color;
          return (
            <div key={stage} style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color,
                  marginBottom: 8,
                  padding: '6px 12px',
                  background: 'var(--bg2)',
                  borderRadius: 6,
                  borderLeft: `3px solid ${color}`,
                }}
              >
                {stage} ({items.length})
              </div>
              <div className="panel">
                <div className="tbl-wrap">
                  <table className="innovic-table">
                    <thead>
                      <tr>
                        <th>SO</th>
                        <th>Customer</th>
                        <th className="td-ctr">Stuck For</th>
                        <th className="td-ctr">Threshold</th>
                        <th className="td-ctr">Over By</th>
                        <th>Since</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => {
                        const over = it.days - it.threshold;
                        const oc = overColor(over);
                        return (
                          <tr key={`${it.soId}:${it.stage}:${i}`}>
                            <td>
                              <Link
                                to="/sales-orders/$id"
                                params={{ id: it.soId }}
                                className="td-code"
                                style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                              >
                                {it.soNo}
                              </Link>
                            </td>
                            <td style={{ fontSize: 12 }}>{it.customer ?? '—'}</td>
                            <td className="td-ctr mono fw-700" style={{ color: oc }}>
                              {it.days} days
                            </td>
                            <td className="td-ctr mono text3">{it.threshold} days</td>
                            <td className="td-ctr mono fw-700" style={{ color: oc }}>
                              +{over}d
                            </td>
                            <td className="text3" style={{ fontSize: 11 }}>
                              {it.since ?? '—'}
                            </td>
                            <td style={{ fontSize: 11 }}>{it.detail}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })
      )}
      <div className="text3" style={{ fontSize: 11, marginTop: 12 }}>
        💡 Click any SO to open it. Thresholds (days): design {data.thresholds.design} · plan{' '}
        {data.thresholds.planToJc} · material {data.thresholds.materialProc} · production op{' '}
        {data.thresholds.productionOp} · QC {data.thresholds.qc} · assembly {data.thresholds.assembly}.
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 14, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 26, color }}>
        {value}
      </div>
    </div>
  );
}
