// Parts of one assembly (Equipment) SO from its BOM: Required = Qty per Set ×
// Units; Reserved, Issued, Returned, Fitted, To Issue, Still Out.
import type { SoMaterial, SoMaterialLine } from '@innovic/shared';
import { soNoWithInternal } from '@/lib/so-number';
import { RowMenu } from '@/ui/data';

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

export function SoMaterialTable({
  data,
  onRelease,
}: {
  data: SoMaterial;
  /** Planning only: a ⋯ with "Release reservation" on rows with Reserved > 0.
   *  Left out (Store's issue modal) → no ⋯ column at all. */
  onRelease?: ((line: SoMaterialLine) => void) | undefined;
}): React.JSX.Element {
  // The ⋯ column exists only when a row has something to release.
  const showMenu = Boolean(onRelease) && data.lines.some((l) => l.reservedQty > 0);
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
            {showMenu ? <th aria-label="Actions" /> : null}
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
              <td className="mono td-num">{n(l.reservedQty)}</td>
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
                      l.reservedForOthers
                        .map((b) => `${soNoWithInternal(b.soCode, b.soInternalNo)} × ${n(b.qty)}`)
                        .join(', ')
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
              {showMenu ? (
                <td className="td-ctr">
                  <RowMenu
                    label={`Actions for ${l.itemCode}`}
                    items={[
                      {
                        key: 'release',
                        label: 'Release reservation',
                        icon: 'x',
                        group: 'workflow',
                        hidden: l.reservedQty <= 0,
                        onSelect: () => onRelease?.(l),
                      },
                    ]}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
