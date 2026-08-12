// JC ops table — legacy chrome (.innovic-table). Cell/header markup mirrors
// legacy's "Ready to Process" table (renderOpEntry, HTML L5258-5270 rows,
// L5347 header).
//
// Known divergence: legacy's table is GLOBAL (every enriched op with
// available>0 or status 'In Progress', capped at 20) and clicking a row runs
// quickFill(). Ours is scoped to one job card because /op-entry/jc-ops rejects
// an unfiltered query (listJcOpsQuerySchema requires jobCardId | jobCardCode |
// machineId), so the JC No. column legacy leads with would be constant here and
// is omitted. Closing that gap needs a data-layer change, not a markup change.

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
            <th style={{ color: 'var(--green)' }}>Completed</th>
            <th style={{ color: 'var(--amber)' }}>Pending</th>
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
                  <td className="td-ctr mono">{op.opSeq}</td>
                  <td>
                    {op.operation}
                    {/* Rework STILL OWED (0088), not the running total ever
                        raised — jc_ops.rework_qty never decrements, so this
                        marker used to stay lit after the rework was done. */}
                    {op.reworkPendingQty > 0 ? (
                      <span
                        style={{
                          color: 'var(--amber)',
                          fontSize: 9,
                          fontWeight: 700,
                          marginLeft: 3,
                        }}
                        title="Clears when the NC is closed (NC Register → Close Rework)"
                      >
                        ♻{op.reworkPendingQty}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono text3" style={{ fontSize: 11 }}>
                    {machineLabel}
                  </td>
                  <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {op.opType}
                  </td>
                  {/* Completed count. A QC / qc_required step records its
                      throughput as qc_accepted_qty (via `qc` logs), NOT as
                      completed_qty (which only counts `complete` machining
                      logs and is always 0 on a pure QC op). Showing
                      completedQty on those rows made an inspection that had
                      passed every piece read as "0 completed"
                      (IN-JC-26-00093 Op2). Show the accepted count there, with
                      a red ✗ marker for any rejected. */}
                  <td className="td-ctr green mono fw-700">
                    {op.opType === 'qc' || op.qcRequired ? (
                      <>
                        {op.qcAcceptedQty}
                        {op.qcRejectedQty > 0 ? (
                          <span
                            style={{
                              color: 'var(--red)',
                              fontSize: 9,
                              fontWeight: 700,
                              marginLeft: 3,
                            }}
                            title="Rejected at inspection"
                          >
                            ✗{op.qcRejectedQty}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      op.completedQty
                    )}
                  </td>
                  <td className="td-ctr">
                    {/* pending_qty (0087), not `available`. On a QC op
                        `available` is input − op_log completes, and a QC op
                        never gets a complete log — so this column printed the
                        whole batch (50 on IN-JC-26-00085 Op2) against an op
                        that had already inspected every piece. */}
                    <span className="mono fw-700 amber" style={{ fontSize: 15 }}>
                      {op.pendingQty}
                    </span>
                  </td>
                  <td>
                    {op.computedStatus === 'running' ? (
                      <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 12 }}>
                        ▶ Running
                      </span>
                    ) : (
                      <JcOpStatusBadge status={op.computedStatus} />
                    )}
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
