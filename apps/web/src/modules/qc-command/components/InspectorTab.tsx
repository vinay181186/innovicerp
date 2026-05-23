// Inspector Performance tab. Per-inspector calls / accept / reject / rate /
// avg-response from the QC dashboard (legacy _qccRenderInspector).

function rateColor(pct: number | null): string {
  if (pct === null) return 'var(--text3)';
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

export function InspectorTab({
  perf,
}: {
  perf: {
    engineer: string;
    calls: number;
    acceptedQty: number;
    rejectedQty: number;
    ratePct: number | null;
    avgResponseDays: string | null;
  }[];
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">Inspector Performance — this month</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Inspector</th>
              <th style={{ textAlign: 'center' }}>Calls</th>
              <th style={{ textAlign: 'center', color: 'var(--green)' }}>Accept</th>
              <th style={{ textAlign: 'center', color: 'var(--red)' }}>Reject</th>
              <th style={{ textAlign: 'center' }}>Rate</th>
              <th style={{ textAlign: 'center' }}>Avg Resp</th>
            </tr>
          </thead>
          <tbody>
            {perf.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No QC logs this month.
                </td>
              </tr>
            ) : (
              perf.map((p) => (
                <tr key={p.engineer}>
                  <td className="fw-700">{p.engineer}</td>
                  <td className="td-ctr mono fw-700">{p.calls}</td>
                  <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                    {p.acceptedQty}
                  </td>
                  <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                    {p.rejectedQty}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: rateColor(p.ratePct) }}>
                    {p.ratePct === null ? '—' : `${p.ratePct}%`}
                  </td>
                  <td className="td-ctr mono text3">
                    {p.avgResponseDays === null ? '—' : `${p.avgResponseDays}d`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
