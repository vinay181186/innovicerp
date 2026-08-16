// Machine-wise output (0095) — legacy chrome (.innovic-table), same structure
// as op-log-history.tsx.
//
// One permanent row per machine that actually produced qty on this operation.
// Half the parts machined on CNC-01 and the rest on CNC-02 reads as two rows
// (CNC-01 · 50, CNC-02 · 50); changing the op's machine never re-attributes
// production already logged.

import type { OpMachineOutput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';

interface Props {
  rows: OpMachineOutput[];
  isLoading: boolean;
}

export function MachineOutputPanel({ rows, isLoading }: Props): React.JSX.Element {
  const totalQty = rows.reduce((sum, r) => sum + r.completedQty, 0);
  const totalReject = rows.reduce((sum, r) => sum + r.rejectQty, 0);

  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th>Machine</th>
            <th style={{ textAlign: 'center' }}>Entries</th>
            <th style={{ textAlign: 'center' }}>Qty</th>
            <th style={{ textAlign: 'center' }}>Reject</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={6} className="empty-state">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading machine output…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="empty-state">
                No production logged yet.
              </td>
            </tr>
          ) : (
            <>
              {rows.map((r) => (
                <tr key={`${r.jcOpId}:${r.machineId ?? r.machineCode}`}>
                  <td>
                    <div className="td-code cyan">{r.machineCode}</div>
                    <div className="text3" style={{ fontSize: 11 }}>
                      {r.machineName ?? '—'}
                    </div>
                  </td>
                  <td className="td-ctr mono" style={{ fontSize: 11 }}>
                    {r.entryCount}
                  </td>
                  <td className="td-ctr">
                    <span className="mono fw-700" style={{ fontSize: 15, color: 'var(--green)' }}>
                      {r.completedQty}
                    </span>
                  </td>
                  <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                    {r.rejectQty || ''}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.firstLogDate}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.lastLogDate}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="fw-700" style={{ fontSize: 12 }}>
                  Total
                </td>
                <td />
                <td className="td-ctr">
                  <span className="mono fw-700" style={{ fontSize: 15 }}>
                    {totalQty}
                  </span>
                </td>
                <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                  {totalReject || ''}
                </td>
                <td />
                <td />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
