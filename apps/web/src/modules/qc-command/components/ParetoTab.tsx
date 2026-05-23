// Rejection Pareto tab. Top rejection reasons from the QC dashboard
// (nc_register, current month), count + share bar (legacy _qccRenderPareto).

export function ParetoTab({
  reasons,
}: {
  reasons: { reasonCategory: string; count: number; pct: number }[];
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">Top Rejection Reasons</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th style={{ textAlign: 'center' }}>Count</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {reasons.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-state">
                  No rejections recorded.
                </td>
              </tr>
            ) : (
              reasons.map((r) => (
                <tr key={r.reasonCategory}>
                  <td className="fw-700" style={{ fontSize: 12, textTransform: 'capitalize' }}>
                    {r.reasonCategory}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                    {r.count}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div
                        style={{
                          height: 14,
                          width: `${Math.max(r.pct, 2)}%`,
                          background: 'var(--red)',
                          borderRadius: 3,
                          minWidth: 4,
                        }}
                      />
                      <span className="text3" style={{ fontSize: 10 }}>
                        {r.pct}%
                      </span>
                    </div>
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
