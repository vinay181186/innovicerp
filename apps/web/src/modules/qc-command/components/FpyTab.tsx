// First-Pass Yield tab (legacy _qccRenderFPY L18757). FPY by Operation +
// Inspector (side-by-side), plus the lowest-FPY items (quality hot-spots).
// FPY = ops that passed QC on the first attempt with zero rejects.

import type { QcCommandFpy, QcFpyGroupRow, QcFpyItemRow } from '@innovic/shared';

function fpyColor(pct: number): string {
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

function GroupPanel({ title, rows }: { title: string; rows: QcFpyGroupRow[] }): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">{title}</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>{title.includes('Operation') ? 'Operation' : 'Inspector'}</th>
              <th style={{ textAlign: 'center' }}>Total</th>
              <th style={{ textAlign: 'center' }}>Passed</th>
              <th style={{ textAlign: 'center' }}>FPY</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  No QC data yet
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.name}>
                  <td className="fw-700" style={{ fontSize: 12 }}>
                    {r.name}
                  </td>
                  <td className="td-ctr mono">{r.total}</td>
                  <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                    {r.passed}
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: fpyColor(r.pct) }}>
                    {r.pct}%
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

export function FpyTab({ fpy }: { fpy: QcCommandFpy }): React.JSX.Element {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <GroupPanel title="FPY by Operation" rows={fpy.byOperation} />
        <GroupPanel title="FPY by Inspector" rows={fpy.byInspector} />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-hdr">
          <span className="panel-title">⚠ Items with Lowest First-Pass Yield (Quality Issues)</span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th style={{ textAlign: 'center' }}>Total Inspected</th>
                <th style={{ textAlign: 'center' }}>First-Pass</th>
                <th style={{ textAlign: 'center' }}>FPY</th>
              </tr>
            </thead>
            <tbody>
              {fpy.byItem.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No QC data yet
                  </td>
                </tr>
              ) : (
                fpy.byItem.map((it: QcFpyItemRow) => (
                  <tr key={it.code}>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>
                      {it.code}
                    </td>
                    <td style={{ fontSize: 12 }}>{it.name}</td>
                    <td className="td-ctr mono">{it.total}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {it.passed}
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: fpyColor(it.pct) }}>
                      {it.pct}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 FPY = items that passed QC on first attempt with zero rejections. Below 85% indicates
        quality issues. Green ≥ 95%, Amber 85-94%, Red &lt; 85%.
      </div>
    </>
  );
}
