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
        <div className="panel-hdr">
          <span className="panel-title">Inspector Performance</span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Inspector</th>
                <th className="td-ctr">Inspections</th>
                <th className="td-ctr">JCs</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>
                  Accepted
                </th>
                <th className="td-ctr" style={{ color: 'var(--red)' }}>
                  Rejected
                </th>
                <th className="td-ctr">Rej. Rate</th>
                <th className="td-ctr">Current Load</th>
              </tr>
            </thead>
            <tbody>
              {perf.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No inspections recorded yet
                  </td>
                </tr>
              ) : (
                perf.map((p) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Rejection Rate: Green ≤ 5%, Amber 6-15%, Red &gt; 15%. Current Load = items currently
        assigned to the inspector.
      </div>
    </div>
  );
}
