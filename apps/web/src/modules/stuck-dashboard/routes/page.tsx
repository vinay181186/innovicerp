// Stuck Activity Dashboard — mirror of legacy renderStuckDashboard (L18017).
//
// Flags SO phases that have run past their day threshold, grouped by stage and
// sorted by most-over-threshold. Read-only. Thresholds ship as constants for
// v1 (legacy had an editable config; no config store yet).

import type { StuckDashboardResponse, StuckItem } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { apiFetch } from '@/lib/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ListHeader } from '@/ui/layout';

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
  const { data, isLoading, isFetching, isError, error } = useQuery<StuckDashboardResponse>({
    queryKey: ['stuck-dashboard'],
    queryFn: () => apiFetch<StuckDashboardResponse>('/stuck-dashboard'),
    staleTime: 30_000,
  });
  // Client-side search over the rows loaded — SO No., customer, stage, detail.
  const [term, setTerm] = useState('');

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
  const items = data.items.filter((it) =>
    matchesSearchTerm([it.soNo, it.customer, it.stage, it.detail], term),
  );
  for (const it of items) {
    const arr = grouped.get(it.stage);
    if (arr) arr.push(it);
    else grouped.set(it.stage, [it]);
  }
  const stageOrder = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <ListHeader
        title="Stuck Dashboard"
        icon="⚠"
        count={items.length}
        noun="stuck activity"
        nounPlural="stuck activities"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO No., customer, stage, detail…"
        updating={isFetching}
      >
        <StatStrip
          items={[
            {
              key: 'total',
              label: 'Total Stuck',
              count: data.summary.totalStuck,
              color: 'var(--amber2)',
            },
            {
              key: 'critical',
              label: 'Critical (>5d over)',
              count: data.summary.criticalStuck,
              color: 'var(--red2)',
            },
            {
              key: 'stages',
              label: 'Stages Affected',
              count: data.summary.stagesAffected,
              color: 'var(--blue)',
            },
          ]}
        />
      </ListHeader>

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
          <div style={{ fontSize: 48 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>
            All activities on track
          </div>
          <div className="text3" style={{ fontSize: 12, marginTop: 4 }}>
            No activities are stuck beyond threshold
          </div>
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
                    <table className="innovic-table tbl-grid">
                      <thead>
                        <tr>
                          <th>SO No.</th>
                          <th>Customer</th>
                          <th className="th-num">Stuck For</th>
                          <th className="th-num">Threshold</th>
                          <th className="th-num">Over By</th>
                          <th>Since</th>
                          <th>Detail</th>
                          <th>Action</th>
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
                              <td className="td-num mono fw-700" style={{ color: oc }}>
                                {it.days} days
                              </td>
                              <td className="td-num mono text3">{it.threshold} days</td>
                              <td className="td-num mono fw-700" style={{ color: oc }}>
                                +{over}d
                              </td>
                              <td className="text3" style={{ fontSize: 11 }}>
                                {it.since ?? '—'}
                              </td>
                              <td style={{ fontSize: 11 }}>{it.detail}</td>
                              {/* Chase it: a task linked to the SO, titled with
                                  the stage it is stuck in. */}
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <AssignTaskButton
                                  linkedRef={{
                                    type: 'sales_order',
                                    id: it.soId,
                                    display: `SO ${it.soNo}`,
                                    navPage: `/sales-orders/${it.soId}`,
                                  }}
                                  suggestedTitle={`Unstick ${it.soNo} — ${it.stage}`}
                                />
                              </td>
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
