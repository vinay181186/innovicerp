// ADR-193 3c — the last units of an assembly SO: parts Still Out differ from
// what the BOM needs (a cable cut shorter, a spare bolt used). Completing
// fits everything still out; the reason is kept on the record.
import type { AssemblyVariancePart } from '@innovic/shared';
import { useState } from 'react';

const REASON_MIN = 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function VarianceConfirm({
  batchNo,
  parts,
  busy,
  onConfirm,
  onCancel,
}: {
  batchNo: number;
  parts: AssemblyVariancePart[];
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  return (
    <div
      style={{
        margin: '6px 10px',
        padding: 10,
        border: '1px solid var(--amber2)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      <div className="fw-700" style={{ color: 'var(--amber2)' }}>
        Last units of this order (Batch No. {batchNo}) — parts out differ from the BOM
      </div>
      <table className="innovic-table tbl-grid" style={{ margin: '6px 0' }}>
        <thead>
          <tr>
            <th>Item Code</th>
            <th className="th-num">BOM Need</th>
            <th className="th-num">Still Out</th>
            <th className="th-num">Difference</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.itemCode}>
              <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                {p.itemCode}
              </td>
              <td className="mono td-num">{r3(p.needQty)}</td>
              <td className="mono td-num">{r3(p.stillOutQty)}</td>
              <td className="mono fw-700 td-num">{r3(p.stillOutQty - p.needQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text3" style={{ marginBottom: 6 }}>
        Completing fits everything still out. Parts left over? Return them to the store first
        instead.
      </div>
      <input
        type="text"
        className="innovic-input"
        placeholder="Reason, e.g. cable cut 0.5 m shorter on the last unit"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || reason.trim().length < REASON_MIN}
          title={`Reason needed (at least ${REASON_MIN} characters)`}
          onClick={() => onConfirm(reason.trim())}
        >
          Complete Anyway
        </button>
      </div>
    </div>
  );
}
