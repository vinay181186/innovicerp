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
//
// The ACTION column is the point of this table now. The entry fields used to
// sit permanently beside it, belonging to whichever row happened to be
// selected — which is not something you can see while typing a quantity. Each
// row therefore carries its own button, and pressing it opens the entry popup
// headed by that job card and that operation. Clicking anywhere else on the row
// still just selects it, which is what drives the Machine-wise output / Recent
// log panel underneath.

import type { JcOpEnriched } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import type { OpEntryModalTarget } from './op-entry-modal';
import { JcOpStatusBadge } from './status-badge';

interface Props {
  ops: JcOpEnriched[];
  selectedOpId: string | null;
  onSelect: (opId: string) => void;
  /** Open the entry popup on one operation. The host renders exactly one
   *  popup for the whole page, so the table only says WHICH row was pressed. */
  onOpenEntry: (target: OpEntryModalTarget) => void;
}

// Op Type as the user reads it — never the raw code.
const OP_TYPE_LABEL: Record<string, string> = {
  process: 'In-house',
  outsource: 'Outsource',
  qc: 'QC',
};

/** What the row's button should say, or null when this operation has no action
 *  the operator can perform right now.
 *
 *  Same rule as the Job Card detail page (job-cards/components/jc-op-actions.tsx
 *  → JcOpFooter), deliberately — the two screens show the same operations and
 *  must agree about what can be done to them:
 *
 *    • An outsource op gets nothing here. It moves through PR → PO → DC →
 *      Receive in Procurement, not through a production entry.
 *    • Nothing shows while `available <= 0` (the previous op has cleared no
 *      pieces into this one) or while the op is `qc_pending` (waiting on an
 *      inspection). Both mirror the server's own refusals in
 *      op-entry/service.ts, so the button can never be the one that only fails
 *      on click.
 *    • Start vs Log is a SESSION question, not a status one: `activeRunningOpId`
 *      is the running_ops row holding this op right now, or null. Something
 *      running → ✓ Complete (add production to it); nothing running →
 *      ▶ Start Operation.
 *      They are branches of one chain, so exactly one can ever render.
 *
 *  QC diverges from the Job Card page on purpose. There, 🔬 QC sends the
 *  inspector to the QC Call Register; here the popup renders the QC inspection
 *  sub-form itself (OpEntryForm switches on qc-bearing), so the inspection is
 *  made on this screen and the gate is the one the submit enforces —
 *  qc_submit.entry, not qc_submit.view. `qcPending` is the right quantity for a
 *  QC row (a QC op never gets a `complete` log, so `available` there is the
 *  whole batch); with nothing pending there is nothing to inspect.
 */
function rowAction(
  op: JcOpEnriched,
  canOpEntry: boolean,
  canQcSubmit: boolean,
): { label: string; mode: 'start' | 'complete'; primary: boolean } | null {
  if (op.opType === 'outsource') return null;

  // A qc-bearing op is a dedicated QC op OR a process op flagged qc_required —
  // the same test OpEntryForm uses to decide it will render the inspection
  // form, so the button and the form it opens can never disagree.
  if (op.opType === 'qc' || op.qcRequired) {
    if (!canQcSubmit || op.qcPending <= 0) return null;
    return { label: `🔬 Inspect (${op.qcPending})`, mode: 'complete', primary: true };
  }

  if (!canOpEntry) return null;
  if (op.available <= 0 || op.computedStatus === 'qc_pending') return null;
  return op.activeRunningOpId !== null
    ? { label: '✓ Complete', mode: 'complete', primary: true }
    : { label: '▶ Start Operation', mode: 'start', primary: false };
}

export function JcOpsTable({ ops, selectedOpId, onSelect, onOpenEntry }: Props): React.JSX.Element {
  // Gated on the same keys the entry form itself checks (op-entry-form.tsx:77-78),
  // so a user who could not save is never shown the button. Hidden, never
  // disabled — what every other action button in this app does — and hidden
  // too while the access matrix is still loading.
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const canQcSubmit = effectiveFormPerms(eff, 'qc_submit').entry;

  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th>Op</th>
            <th>Operation</th>
            <th>Planned Machine</th>
            <th>Actual Machine</th>
            <th>Op Type</th>
            <th className="th-num" style={{ color: 'var(--green2)' }}>
              Completed
            </th>
            <th className="th-num" style={{ color: 'var(--amber2)' }}>
              Available
            </th>
            <th>Op Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {ops.length === 0 ? (
            <tr>
              <td colSpan={9} className="empty-state">
                No ops on this job card.
              </td>
            </tr>
          ) : (
            ops.map((op) => {
              const machineLabel = op.machineCode ?? op.machineCodeText ?? '—';
              const isSelected = op.id === selectedOpId;
              const action = rowAction(op, canOpEntry, canQcSubmit);
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
                  <td className="mono">{opSrNo(op.opSeq)}</td>
                  <td>
                    {op.operation}
                    {/* Rework STILL OWED (0088), not the running total ever
                        raised — jc_ops.rework_qty never decrements, so this
                        marker used to stay lit after the rework was done. */}
                    {op.reworkPendingQty > 0 ? (
                      <span
                        style={{
                          color: 'var(--amber2)',
                          fontSize: 11,
                          fontWeight: 700,
                          marginLeft: 3,
                        }}
                        title="Clears when the NC is closed."
                      >
                        ♻{op.reworkPendingQty}
                      </span>
                    ) : null}
                  </td>
                  {/* ADR-164 — PLANNED (jc_ops machine, where the remaining
                      qty is routed) and ACTUAL (the open session's machine, or
                      whoever made the completed qty) each get their own column;
                      the actual turns amber only when it is not the plan. A QC
                      op carries no machine and an outsource op names its vendor
                      route as the plan, so those keep the plain label with a
                      dash for the actual. */}
                  <td className="mono text3" style={{ fontSize: 11 }}>
                    {op.opType === 'qc' || op.opType === 'outsource' ? (
                      machineLabel
                    ) : (
                      <PlannedMachineCell planned={machineLabel} />
                    )}
                  </td>
                  <td className="mono text3" style={{ fontSize: 11 }}>
                    {op.opType === 'qc' || op.opType === 'outsource' ? (
                      '—'
                    ) : (
                      <ActualMachineCell
                        planned={machineLabel}
                        activeRunningMachineCode={op.activeRunningMachineCode}
                        machines={op.machines}
                      />
                    )}
                  </td>
                  <td className="text3" style={{ fontSize: 11 }}>
                    {OP_TYPE_LABEL[op.opType] ?? op.opType}
                  </td>
                  {/* Completed count. A QC / qc_required step records its
                      throughput as qc_accepted_qty (via `qc` logs), NOT as
                      completed_qty (which only counts `complete` machining
                      logs and is always 0 on a pure QC op). Showing
                      completedQty on those rows made an inspection that had
                      passed every piece read as "0 completed"
                      (IN-JC-26-00093 Op2). Show the accepted count there, with
                      a red ✗ marker for any rejected. */}
                  <td className="green mono fw-700 td-num">
                    {op.opType === 'qc' || op.qcRequired ? (
                      <>
                        {op.qcAcceptedQty}
                        {op.qcRejectedQty > 0 ? (
                          <span
                            style={{
                              color: 'var(--red2)',
                              fontSize: 11,
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
                  <td className="td-num">
                    {/* Available = what can be worked on this op right now —
                        the same number the By Machine view, Machine Loading and
                        Job Queue show. A qc-bearing op never gets a `complete`
                        log, so `available` there is the whole batch; its
                        workable qty is qcPending (what the Inspect button uses). */}
                    <span className="mono fw-700 amber" style={{ fontSize: 15 }}>
                      {op.opType === 'qc' || op.qcRequired ? op.qcPending : op.available}
                    </span>
                  </td>
                  <td>
                    <JcOpStatusBadge status={op.computedStatus} />
                  </td>
                  {/* The button is wrapped so pressing it does not also fire the
                      row's own click. The host still selects the row from
                      onOpenEntry, so the panel underneath follows the operation
                      being logged. */}
                  <td>
                    {action ? (
                      <div onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={`btn btn-sm${action.primary ? ' btn-primary' : ''}`}
                          onClick={() =>
                            onOpenEntry({
                              op,
                              activeRunningId: op.activeRunningOpId,
                              mode: action.mode,
                            })
                          }
                        >
                          {action.label}
                        </button>
                      </div>
                    ) : null}
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
