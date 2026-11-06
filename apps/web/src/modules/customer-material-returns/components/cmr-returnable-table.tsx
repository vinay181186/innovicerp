// "Material that can go back" on New Customer Material Return (routes/create.tsx):
// the server's returnable rows, with a Return Qty box on each.

import type { CustomerMaterialReturnableRow } from '@innovic/shared';
import { CMR_KIND_LABEL } from './cmr-columns';

/** One returnable row's identity: kind + JWSO line (+ Party GRN line). */
export function cmrRowKey(r: CustomerMaterialReturnableRow): string {
  return `${r.kind}:${r.jwLineId}:${r.partyGrnLineId ?? ''}`;
}

export function CmrReturnableTable({
  rows,
  qtys,
  onQtyChange,
}: {
  rows: CustomerMaterialReturnableRow[];
  /** Typed Return Qty per returnable row (cmrRowKey → text). */
  qtys: Record<string, string>;
  onQtyChange: (key: string, value: string) => void;
}): React.JSX.Element {
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th className="th-ctr">Return Kind</th>
            <th className="th-ctr">JWSO Line</th>
            <th className="th-ctr" style={{ color: 'var(--purple)' }}>
              POL
            </th>
            <th>Item Code</th>
            <th>Customer RM</th>
            <th>Party GRN No.</th>
            <th className="th-num">Returnable Qty</th>
            <th className="th-num">Return Qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = cmrRowKey(r);
            return (
              <tr key={k}>
                <td className="td-ctr">
                  <span className={`badge ${r.kind === 'rejected' ? 'b-red' : 'b-green'}`}>
                    {CMR_KIND_LABEL[r.kind]}
                  </span>
                </td>
                <td className="td-ctr mono" style={{ color: 'var(--purple)' }}>
                  L{r.jwLineNo}
                </td>
                <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
                  {r.clientPoLineNo ?? '—'}
                </td>
                <td className="td-code" style={{ color: 'var(--text)' }}>
                  {r.partCode ?? '—'}
                </td>
                <td className="td-code" style={{ color: 'var(--text)' }}>
                  {r.rmItemCode ?? r.partyMaterialCode}
                </td>
                <td className="mono text2">{r.partyGrnCode ?? '—'}</td>
                <td className="td-num mono fw-700">{r.returnableQty}</td>
                <td className="td-num">
                  <input
                    type="number"
                    min={1}
                    max={r.returnableQty}
                    step={1}
                    className="innovic-input"
                    aria-label={`Return Qty for JWSO L${r.jwLineNo} ${CMR_KIND_LABEL[r.kind]}`}
                    placeholder="—"
                    value={qtys[k] ?? ''}
                    onChange={(e) => onQtyChange(k, e.target.value)}
                    style={{ width: '10ch', fontWeight: 700 }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
