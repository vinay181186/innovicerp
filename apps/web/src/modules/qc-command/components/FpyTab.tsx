// First-Pass Yield tab (legacy _qccRenderFPY L18757). FPY by Operation +
// Inspector (side-by-side), plus the lowest-FPY items (quality hot-spots).
// FPY = ops that passed QC on the first attempt with zero rejects.

import type { QcCommandFpy, QcFpyGroupRow, QcFpyItemRow } from '@innovic/shared';

function fpyColor(pct: number): string {
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

// Legacy L18795/L18805 hand-rolls a compact sub-header here rather than using
// .panel-hdr/.panel-title (which it defines but does not use on this page).
function SubHdr({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: '10px 14px',
        fontSize: 12,
        fontWeight: 700,
        borderBottom: '1px solid var(--border)',
        color: 'var(--text2)',
      }}
    >
      {children}
    </div>
  );
}

function GroupPanel({
  title,
  label,
  rows,
  nameWeight,
}: {
  title: string;
  label: string;
  rows: QcFpyGroupRow[];
  nameWeight?: number;
}): React.JSX.Element {
  return (
    <div className="panel">
      <SubHdr>{title}</SubHdr>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>{label}</th>
              <th className="td-ctr">Total</th>
              <th className="td-ctr">Passed</th>
              <th className="td-ctr">FPY</th>
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
                  <td style={{ fontSize: 12, fontWeight: nameWeight }}>{r.name}</td>
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
        {/* Legacy L18799 leaves the operation name unweighted; L18809 gives the
            inspector name an inline font-weight:600 (there is no .fw-600). */}
        <GroupPanel title="FPY by Operation" label="Operation" rows={fpy.byOperation} />
        <GroupPanel
          title="FPY by Inspector"
          label="Inspector"
          rows={fpy.byInspector}
          nameWeight={600}
        />
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <SubHdr>⚠ Items with Lowest First-Pass Yield (Quality Issues)</SubHdr>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="td-ctr">Total Inspected</th>
                <th className="td-ctr">First-Pass</th>
                <th className="td-ctr">FPY</th>
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
                    {/* Legacy L18823 hardcodes #8B5CF6, not var(--purple) (#7c3aed). */}
                    <td className="td-code" style={{ color: '#8B5CF6' }}>
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
