// Live operations board — legacy chrome (.panel / .innovic-table / .btn).

import type { RunningOp, StopOpInput } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Square } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
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
        onError: (e) => setStopError(e instanceof Error ? e.message : 'Stop failed'),
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
                <th>JC</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Op</th>
                <th>Operation</th>
                <th>Machine</th>
                <th>Operator</th>
                <th>Started</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {running.length === 0 ? (
                <tr>
                  {/* Ten columns since Item Code and Item Name were added — the
                      empty row must span the whole table or it draws short. */}
                  <td colSpan={10} className="empty-state">
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
                    <td className="mono">{r.opSeq}</td>
                    <td>{r.operation}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.operatorName ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {r.startDate} {r.startTime.slice(0, 5)}
                    </td>
                    <td>
                      <RunningOpStatusBadge status={r.status} />
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
                  <th>JC</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Op</th>
                  <th>Operation</th>
                  <th>Machine</th>
                  <th>Operator</th>
                  <th>Ended</th>
                  <th>Status</th>
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
                    <td className="mono">{r.opSeq}</td>
                    <td>{r.operation}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
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
            availableQty: stopRow.availableQty,
            // The Stop box names the part as well as the job. `RunningOp`
            // carries all three, and the box is where an operator checks they
            // are stopping the right row before typing a quantity — the one
            // moment a wrong job card costs real pieces.
            itemCode: stopRow.itemCode,
            itemRevision: stopRow.itemRevision,
            itemName: stopRow.itemName,
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
