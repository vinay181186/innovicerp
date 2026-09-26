// Stuck Activity Dashboard — mirror of legacy renderStuckDashboard (L18017).
//
// Flags SO phases that have run past their day threshold, grouped by stage and
// sorted by most-over-threshold. Read-only. Thresholds ship as constants for
// v1 (legacy had an editable config; no config store yet).

import type { StuckDashboardResponse, StuckItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { StatStrip } from '@/components/shared/stat-strip';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';

export const stuckDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stuck-dashboard',
  component: StuckDashboardPage,
});

// Severity ramp for the "over by" columns (legacy L18138 `over>10?'#7f1d1d':
// over>5?'#b91c1c':'#ea580c'`). Legacy's literals are tuned for its DARK theme;
// this port is light, so map to the nearest tokens and keep the three distinct
// escalating steps rather than copying the hex (ISSUE-067).
function overColor(over: number): string {
  return over > 10 ? 'var(--red2)' : over > 5 ? 'var(--red)' : 'var(--orange)';
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
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load stuck jobs. Try again.'}
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
      <div className="section-hdr">Stuck Dashboard</div>

      <div style={{ marginBottom: 16 }}>
        <StatStrip
          items={[
            {
              key: 'total',
              label: 'Total Stuck',
              count: data.summary.totalStuck,
              color: 'var(--amber)',
            },
            {
              key: 'critical',
              label: 'Critical',
              count: data.summary.criticalStuck,
              color: 'var(--red)',
              title: 'Over by 5+ days',
            },
            {
              key: 'stages',
              label: 'Stages Affected',
              count: data.summary.stagesAffected,
              color: 'var(--blue)',
            },
          ]}
        />
      </div>

      {data.summary.totalStuck === 0 ? (
        <div
          className="empty-state"
          style={{
            padding: 60,
            color: 'var(--green2)',
            background: 'var(--sig-ok-bg)',
            borderRadius: 'var(--radius2)',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700 }}>No stuck jobs.</div>
        </div>
      ) : (
        <>
          {stageOrder.map(([stage, items]) => {
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
                          <th>SO No.</th>
                          <th>Customer</th>
                          <th className="td-ctr">Stuck For</th>
                          <th className="td-ctr">Over By</th>
                          <th>Stuck Since</th>
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
                                  style={{ color: 'var(--cyan)', textDecoration: 'underline' }}
                                >
                                  {it.soNo}
                                </Link>
                              </td>
                              <td style={{ fontSize: 12 }}>{it.customer ?? '—'}</td>
                              <td className="td-ctr mono fw-700" style={{ color: oc }}>
                                {it.days} days
                              </td>
                              <td className="td-ctr mono fw-700" style={{ color: oc }}>
                                +{over} days
                              </td>
                              <td className="text3" style={{ fontSize: 11 }}>
                                {fmtDate(it.since)}
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
          })}
          {/* Thresholds on demand — a "?" with the day limits in its tooltip. */}
          <div
            className="text3"
            style={{ fontSize: 11, marginTop: 12, cursor: 'help', display: 'inline-block' }}
            title={`Thresholds (days): design ${data.thresholds.design} · plan ${data.thresholds.planToJc} · material ${data.thresholds.materialProc} · production op ${data.thresholds.productionOp} · QC ${data.thresholds.qc} · assembly ${data.thresholds.assembly}`}
          >
            ? Thresholds
          </div>
        </>
      )}
    </div>
  );
}
