// Live operations board — legacy chrome (.panel / .innovic-table / .btn).

import type { RunningOp, StopOpInput } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Square } from 'lucide-react';
import { useState } from 'react';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtJcDate } from '@/modules/job-cards/lib/fmt-jc-date';
import { useStopOp } from '../api';
import { RunningOpStatusBadge } from './status-badge';
import { StopOpModal } from './stop-op-modal';

interface Props {
  rows: RunningOp[];
}

/** The JC number, as a way INTO that card rather than a code to copy and hunt
 *  for on another screen. Colour, mono face and weight are inherited from the
 *  cell it sits in, so the code keeps exactly the identity it has on every other
 *  board — making it reachable is not meant to make it look like a new kind of
 *  thing, hence no underline and no link colour of its own. A JC number is
 *  short, so it stays on one line on these dense boards. */
function JcLink({ id, code }: { id: string; code: string }): React.JSX.Element {
  return (
    <Link
      to="/job-cards/$id"
      params={{ id }}
      title="View job card status"
      style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      {code}
    </Link>
  );
}

/** Item Code + Item Name — what the running operation is actually making. The
 *  board used to name only a JC code, which meant looking the part up elsewhere
 *  before you could tell whether the right thing was on the machine.
 *
 *  The code carries the customer's drawing revision as `CODE/REV` through the
 *  one shared helper, so the separator cannot drift from the other boards. A
 *  JW-sourced or standalone card has no SO line behind it and therefore no
 *  revision: those rows show the bare code, with no trailing slash.
 *
 *  The name is long free text, so it truncates with the full value on hover; the
 *  code is short and never wraps. */
function ItemCells({ r }: { r: RunningOp }): React.JSX.Element {
  return (
    <>
      {/* POL — the line number printed on the CUSTOMER's own purchase order,
          immediately before the item code. '—' when there is no sales order
          behind the job card. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {r.clientPoLineNo ?? '—'}
      </td>
      <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {itemCodeWithRev(r.itemCode, r.itemRevision)}
      </td>
      <td
        title={r.itemName ?? ''}
        style={{
          fontSize: 12,
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {r.itemName ?? '—'}
      </td>
    </>
  );
}

export function RunningOpsBoard({ rows }: Props): React.JSX.Element {
  const stop = useStopOp();
  // Stopping a session commits produced qty to op_log → op_entry entry (Production).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const running = rows.filter((r) => r.status === 'running');
  const recent = rows.filter((r) => r.status !== 'running').slice(0, 20);
  // The row whose Stop box is open, and the server's message if it refused.
  const [stopRow, setStopRow] = useState<RunningOp | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  function submitStop(input: StopOpInput): void {
    if (!stopRow) return;
    setStopError(null);
    stop.mutate(
      { id: stopRow.id, ...input },
      {
        onSuccess: () => setStopRow(null),
        onError: (e) =>
          setStopError(e instanceof Error ? e.message : 'Could not stop operation. Try again.'),
      },
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Running now</span>
          <span className="mono text3" style={{ fontSize: 11 }}>
            {running.length} session{running.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>JC No.</th>
                {/* POL — the CUSTOMER's own PO line number, before the item. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Op</th>
                <th>Operation</th>
                <th>Planned Machine</th>
                <th>Actual Machine</th>
                <th>Operator</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {running.length === 0 ? (
                <tr>
                  {/* Eleven columns since Planned Machine and Actual Machine
                      each get their own column — the empty row must span the
                      whole table or it draws short. */}
                  <td colSpan={11} className="empty-state">
                    No ops currently running.
                  </td>
                </tr>
              ) : (
                running.map((r) => (
                  <tr key={r.id}>
                    <td className="td-code cyan">
                      <JcLink id={r.jobCardId} code={r.jobCardCode} />
                    </td>
                    <ItemCells r={r} />
                    <td className="mono">{opSrNo(r.opSeq)}</td>
                    <td>{r.operation}</td>
                    {/* ADR-164 — the session's machine is the ACTUAL; the op's
                        jc_ops machine is the PLAN. Each gets its own column on
                        every in-house row; an OSP session has no machine. */}
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.isOsp ? 'OSP' : <PlannedMachineCell planned={r.plannedMachineCode} />}
                    </td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.isOsp ? (
                        '—'
                      ) : (
                        <ActualMachineCell
                          planned={r.plannedMachineCode}
                          activeRunningMachineCode={r.machineCode}
                        />
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.operatorName ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {fmtJcDate(r.startDate)} {r.startTime.slice(0, 5)}
                    </td>
                    <td>
                      {canOpEntry ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={stop.isPending}
                          onClick={() => {
                            setStopError(null);
                            setStopRow(r);
                          }}
                        >
                          <Square size={13} /> Stop
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {recent.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Recent</span>
            <span className="mono text3" style={{ fontSize: 11 }}>
              last {recent.length}
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC No.</th>
                  {/* POL — the CUSTOMER's own PO line number, before the item. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Op</th>
                  <th>Operation</th>
                  <th>Planned Machine</th>
                  <th>Actual Machine</th>
                  <th>Operator</th>
                  <th>Ended</th>
                  <th>Op Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    {/* Same treatment as Running now: a finished session is the
                        one you most often want to open the card for. */}
                    <td className="td-code">
                      <JcLink id={r.jobCardId} code={r.jobCardCode} />
                    </td>
                    <ItemCells r={r} />
                    <td className="mono">{opSrNo(r.opSeq)}</td>
                    <td>{r.operation}</td>
                    {/* ADR-164 — the session's machine is the ACTUAL; the op's
                        jc_ops machine is the PLAN. Each gets its own column on
                        every in-house row; an OSP session has no machine. */}
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.isOsp ? 'OSP' : <PlannedMachineCell planned={r.plannedMachineCode} />}
                    </td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.isOsp ? (
                        '—'
                      ) : (
                        <ActualMachineCell
                          planned={r.plannedMachineCode}
                          activeRunningMachineCode={r.machineCode}
                        />
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.operatorName ?? '—'}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.endedAt ? r.endedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                    <td>
                      <RunningOpStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {stopRow ? (
        <StopOpModal
          target={{
            runningOpId: stopRow.id,
            jobCardCode: stopRow.jobCardCode,
            opSeq: stopRow.opSeq,
            operation: stopRow.operation,
            machineLabel: stopRow.machineCode ?? (stopRow.isOsp ? 'OSP' : '—'),
            // Planned beside actual (ADR-164). Spread, not `undefined`, on an
            // OSP row: exactOptionalPropertyTypes refuses an explicit undefined.
            ...(stopRow.isOsp
              ? {}
              : { plannedMachineLabel: stopRow.plannedMachineCode ?? stopRow.machineCode ?? '—' }),
            availableQty: stopRow.availableQty,
            // The Stop box names the part as well as the job. `RunningOp`
            // carries all three, and the box is where an operator checks they
            // are stopping the right row before typing a quantity — the one
            // moment a wrong job card costs real pieces.
            itemCode: stopRow.itemCode,
            itemRevision: stopRow.itemRevision,
            itemName: stopRow.itemName,
            // POL — the CUSTOMER's own PO line number, shown beside the item.
            clientPoLineNo: stopRow.clientPoLineNo,
          }}
          pending={stop.isPending}
          errorText={stopError}
          onCancel={() => {
            setStopRow(null);
            setStopError(null);
          }}
          onSubmit={submitStop}
        />
      ) : null}
    </div>
  );
}
