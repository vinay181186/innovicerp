// Rejection Pareto tab (legacy _qccRenderPareto L18833). ALL NCs grouped by
// reason, sorted by rejected qty desc: rank #, NC count, rejected qty, % of
// total qty, top-3 items, rank-colored distribution bar + header totals.

import { NC_REASON_CATEGORY_LABELS, type QcCommandPareto } from '@innovic/shared';

const RANK_COLORS = ['#EF4444', '#F59E0B', '#F97316', '#64748B'];
function rankColor(i: number): string {
  return RANK_COLORS[i] ?? '#64748B';
}

function reasonLabel(reason: string): string {
  return (NC_REASON_CATEGORY_LABELS as Record<string, string>)[reason] ?? reason;
}

export function ParetoTab({ pareto }: { pareto: QcCommandPareto }): React.JSX.Element {
  return (
    <div>
      <div className="panel">
        {/* Legacy L18846 hand-rolls this sub-header instead of .panel-hdr.
            totalCount/totalQty are server-computed over every NC — not summed here. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Rejection Reason Pareto — Total: {pareto.totalCount} NCs, {pareto.totalQty} pcs rejected
        </div>
        {pareto.rows.length === 0 ? (
          <div className="empty-state" style={{ color: 'var(--green)' }}>
            ✅ No rejections recorded
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Reason</th>
                  <th className="td-ctr">NC Count</th>
                  <th className="td-ctr">Rejected Qty</th>
                  <th className="td-ctr">% of Total</th>
                  <th>Top Items</th>
                  <th style={{ width: 200 }}>Distribution</th>
                </tr>
              </thead>
              <tbody>
                {pareto.rows.map((r, i) => (
                  <tr key={r.reason}>
                    <td className="td-ctr mono fw-700">{i + 1}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{reasonLabel(r.reason)}</td>
                    <td className="td-ctr mono">{r.count}</td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                      {r.rejectedQty}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: rankColor(i) }}>
                      {r.pct}%
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {r.topItems || '—'}
                    </td>
                    <td>
                      <div
                        style={{
                          background: 'var(--bg3)',
                          borderRadius: 10,
                          height: 18,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{ background: rankColor(i), height: '100%', width: `${r.pct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Legacy L18848 returns before emitting the tip when there are no rows. */}
      {pareto.rows.length > 0 ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
          💡 Focus on the top 2-3 reasons to improve quality. The Pareto principle: often 80% of
          rejections come from 20% of causes.
        </div>
      ) : null}
    </div>
  );
}
