// JC ops table — legacy chrome (.innovic-table). Mirrors the per-JC ops grid
// used by Op Entry; click a row to select the op for the entry form.

import type { JcOpEnriched } from '@innovic/shared';
import { JcOpStatusBadge } from './status-badge';

interface Props {
  ops: JcOpEnriched[];
  selectedOpId: string | null;
  onSelect: (opId: string) => void;
}

export function JcOpsTable({ ops, selectedOpId, onSelect }: Props): React.JSX.Element {
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th>Op</th>
            <th>Operation</th>
            <th>Machine</th>
            <th>Type</th>
            <th style={{ textAlign: 'center' }}>Done</th>
            <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Available</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ops.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty-state">
                No ops on this job card.
              </td>
            </tr>
          ) : (
            ops.map((op) => {
              const machineLabel = op.machineCode ?? op.machineCodeText ?? '—';
              const isSelected = op.id === selectedOpId;
              return (
                <tr
                  key={op.id}
                  data-selected={isSelected ? 'true' : undefined}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg4)' : undefined,
                  }}
                  onClick={() => onSelect(op.id)}
                >
                  <td className="td-ctr mono fw-700">{op.opSeq}</td>
                  <td>{op.operation}</td>
                  <td className="mono text3" style={{ fontSize: 11 }}>
                    {machineLabel}
                  </td>
                  <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {op.opType}
                  </td>
                  <td className="td-ctr green mono fw-700">{op.completedQty}</td>
                  <td className="td-ctr">
                    <span className="mono fw-700 amber" style={{ fontSize: 15 }}>
                      {op.available}
                    </span>
                  </td>
                  <td>
                    <JcOpStatusBadge status={op.computedStatus} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
