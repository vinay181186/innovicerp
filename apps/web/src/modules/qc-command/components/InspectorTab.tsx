// Inspector Performance tab (legacy _qccRenderInspector L18873). Per-inspector
// over ALL QC entries: inspections, distinct JCs, accepted, rejected, reject
// rate (green ≤5 / amber ≤15 / red), current assigned load. Avg-Hrs/Inspection
// dropped — op_log has no hours column (legacy itself flagged it mobile-only).

import type { QcInspectorPerfRow } from '@innovic/shared';

function rejColor(pct: number): string {
  if (pct <= 5) return 'var(--green)';
  if (pct <= 15) return 'var(--amber)';
  return 'var(--red)';
}

export function InspectorTab({ perf }: { perf: QcInspectorPerfRow[] }): React.JSX.Element {
  return (
    <div>
      <div className="panel">
        {/* Legacy L18895 hand-rolls this sub-header instead of .panel-hdr. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Inspector Performance
        </div>
        {/* Legacy L18896 returns early with a bare line — no table — when empty. */}
        {perf.length === 0 ? (
          <div className="empty-state">No inspections recorded yet</div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                {/* Legacy L18897 colours none of these headers. */}
                <tr>
                  <th>Inspector</th>
                  <th className="td-ctr">Inspections</th>
                  <th className="td-ctr">JCs</th>
                  <th className="td-ctr">Accepted</th>
                  <th className="td-ctr">Rejected</th>
                  <th className="td-ctr">Rej. Rate</th>
                  <th className="td-ctr">Current Load</th>
                </tr>
              </thead>
              <tbody>
                {perf.map((p) => (
                  <tr key={p.name}>
                    <td className="fw-700" style={{ fontSize: 12 }}>
                      {p.name}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {p.inspections}
                    </td>
                    <td className="td-ctr mono">{p.jcs}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {p.accepted}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                      {p.rejected}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: rejColor(p.rejRate) }}>
                      {p.rejRate}%
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                      {p.currentLoad}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Legacy L18896 returns before emitting the tip when there are no rows. */}
      {perf.length > 0 ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
          💡 Rejection Rate: Green ≤ 5%, Amber 6-15%, Red &gt; 15%. Current Load = items currently
          assigned to the inspector.
        </div>
      ) : null}
    </div>
  );
}
