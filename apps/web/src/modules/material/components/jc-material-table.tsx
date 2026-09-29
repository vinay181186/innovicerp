// Material of one Job Card: Required (RM Qty per piece × Order Qty), Issued,
// Returned, To Issue, Available — all derived on the server (ADR-193 3b).
import type { JcMaterial } from '@innovic/shared';

const n = (v: number | null): string => (v == null ? '—' : String(Math.round(v * 1000) / 1000));

export function JcMaterialTable({ data }: { data: JcMaterial }): React.JSX.Element {
  return (
    <div className="tbl-wrap">
      <table className="innovic-table tbl-grid">
        <thead>
          <tr>
            <th>Item Code</th>
            <th>Item Name</th>
            <th>UOM</th>
            <th className="th-num">Required</th>
            <th className="th-num">Issued</th>
            <th className="th-num">Returned</th>
            <th className="th-num">To Issue</th>
            <th className="th-num">Available</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.itemId}>
              <td>
                <span className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
                  {l.itemCode}
                </span>
              </td>
              <td>{l.itemName || '—'}</td>
              <td className="text3">{l.uom || '—'}</td>
              <td className="mono td-num">{n(l.requiredQty)}</td>
              <td className="mono td-num">{n(l.issuedQty)}</td>
              <td className="mono td-num">{n(l.returnedQty)}</td>
              <td
                className="mono fw-700 td-num"
                style={{
                  color: l.toIssueQty != null && l.toIssueQty < 0 ? 'var(--red2)' : undefined,
                }}
              >
                {n(l.toIssueQty)}
              </td>
              <td className="mono td-num">{n(l.availableQty)}</td>
            </tr>
          ))}
          {data.lines.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty-state">
                {data.planned
                  ? 'Nothing issued yet.'
                  : 'No RM Item on this card’s Route Card — nothing is required, issues are not capped.'}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
