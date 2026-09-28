// Parts of one assembly (Equipment) SO from its BOM: Required = Qty per Set ×
// Units; Reserved, Issued, Returned, Fitted, To Issue, Still Out.
import type { SoMaterial, SoMaterialLine } from '@innovic/shared';

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

export function SoMaterialTable({
  data,
  onRelease,
}: {
  data: SoMaterial;
  /** Planning only: a Release button on rows with Reserved > 0. */
  onRelease?: ((line: SoMaterialLine) => void) | undefined;
}): React.JSX.Element {
  if (!data.hasBom && data.lines.length === 0) {
    return (
      <div className="empty-state">
        This SO has no BOM — parts can only be issued against an Equipment SO with a BOM.
      </div>
    );
  }
  return (
    <div className="tbl-wrap">
      {!data.hasBom ? (
        <div className="text3" style={{ fontSize: 12, marginBottom: 6 }}>
          This SO has no BOM now — the parts below are still out on its issues.
        </div>
      ) : null}
      <table className="innovic-table tbl-grid">
        <thead>
          <tr>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="th-num">Qty per Set</th>
            <th className="th-num">Required</th>
            <th className="th-num">Reserved</th>
            <th className="th-num">Issued</th>
            <th className="th-num">Returned</th>
            <th className="th-num">Fitted</th>
            <th className="th-num">To Issue</th>
            <th className="th-num">Still Out</th>
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
                {l.notInBom ? (
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber2)' }}>
                    Not in BOM — return it
                  </div>
                ) : null}
              </td>
              <td>{l.itemName || '—'}</td>
              <td className="mono td-num">{n(l.qtyPerSet)}</td>
              <td className="mono td-num">{n(l.requiredQty)}</td>
              <td className="mono td-num">
                {n(l.reservedQty)}
                {onRelease && l.reservedQty > 0 ? (
                  <div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0 4px', fontSize: 10 }}
                      onClick={() => onRelease(l)}
                    >
                      Release
                    </button>
                  </div>
                ) : null}
              </td>
              <td className="mono td-num">{n(l.issuedQty)}</td>
              <td className="mono td-num">{n(l.returnedQty)}</td>
              <td className="mono td-num">{n(l.fittedQty)}</td>
              <td className="mono fw-700 td-num">{n(l.toIssueQty)}</td>
              <td className="mono td-num">{n(l.stillOutQty)}</td>
              <td
                className="mono td-num"
                title={
                  l.reservedForOthers.length
                    ? 'Reserved for: ' +
                      l.reservedForOthers.map((b) => `${b.soCode} × ${n(b.qty)}`).join(', ')
                    : undefined
                }
              >
                {n(l.availableQty)}
                {l.reservedForOthers.length ? (
                  <div className="text3" style={{ fontSize: 10 }}>
                    reserved for others {n(l.reservedForOthers.reduce((s, b) => s + b.qty, 0))}
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
