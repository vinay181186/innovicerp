// THE popup every shop-floor entry is made through — Start, Log and Stop, on
// both tabs of Op Entry.
//
// Why it exists: the entry fields used to sit permanently on the screen, once,
// above or beside a LIST of operations. On the By Machine tab that list can be
// five rows long, and the single Date / Time / Shift / Operator strip at the
// top belonged to whichever row you eventually pressed ▶ Start on — which is
// not something you can see. On 10-Sep an operator meant to book 30 pcs against
// IN-JC-26-00017 Op 1 and booked 20 against IN-JC-26-00005 Op 1 instead: the
// wrong row, in a list where JC 0005 sits first and JC 0017 fourth. Nothing was
// on screen at the moment of typing to say which job the numbers would land on.
//
// So the fields no longer exist until an operation has been named. Pressing an
// action on a row opens this box, and the box states — before any field — the
// job card, the operation and the machine the entry is about. You cannot type
// into a form belonging to a different row, because only one form exists and it
// was opened from the row it belongs to.
//
// It deliberately OWNS no entry logic. The body is the existing `OpEntryForm`,
// unchanged, so the material-availability cap, the client-material gate, the
// blocked-reason banner, the QC sub-form with its accept/reject rules and
// report attachment, the TPI branch and the OSP ladder all keep working exactly
// as they did — this only gives that form a heading and a way to close.
//
// Shape follows stop-op-modal.tsx: same overlay, same `.panel` body, same
// close button, so the two boxes an operator meets read as one thing.

import type { JcOpEnriched } from '@innovic/shared';
import { fmtOpSrNo, opSrNo } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useRunningOps } from '../api';
import { OpEntryForm } from './op-entry-form';

/** What the popup was opened against. Which half of the entry form shows is
 *  decided by `activeRunningId`, never by `mode`: a running operation cannot be
 *  started and an idle one has nothing to complete, so there is no choice to
 *  make. `mode` remains on the type because the callers still express an
 *  intent when they open the box; nothing reads it. */
export interface OpEntryModalTarget {
  op: JcOpEnriched;
  /** The running session on this op, or null when nothing is running. Decides
   *  whether the form offers Stop. */
  activeRunningId: string | null;
  mode: 'start' | 'complete';
  /** The machine the operator is standing at when the box was opened from a
   *  machine tile (By Machine tab). Pre-fills the Actual Machine picker; the
   *  op's planned machine is the default otherwise. */
  machineId?: string | null;
}

/** One fact in the heading strip. */
function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 9, letterSpacing: '.06em' }}>
        {label}
      </div>
      <div className="fw-700" style={{ fontSize: 12 }}>
        {value}
      </div>
    </div>
  );
}

export function OpEntryModal({
  target,
  onClose,
  onModeChange,
}: {
  target: OpEntryModalTarget;
  onClose: () => void;
  /** Lets the host remember which half the operator switched to, so reopening
   *  the same row does not throw the choice away. Optional. */
  onModeChange?: (mode: 'start' | 'complete') => void;
}): React.JSX.Element {
  const { op, activeRunningId } = target;
  const isQc = op.opType === 'qc' || op.qcRequired;
  const planned = op.machineCode ?? op.machineCodeText ?? '—';
  const navigate = useNavigate();

  // PLANNED-MACHINE BUSY GATE — the first thing the operator meets. Pressing
  // ▶ Start on an op whose PLANNED machine is running another job opens this
  // box on a "Machine busy" panel, not on a form with a notice under it: the
  // fact that decides what happens next is stated before a single field is
  // offered. Keyed on the machine id the one-running-per-machine index sees.
  // The sessions list is pre-warmed by the Op Entry page, so this answers
  // with the popup, not seconds after it. Two ways on from the panel: open
  // the running op (Complete / Stop frees the machine), or start THIS op on
  // another machine — which opens the form with Actual Machine left blank
  // for the operator to pick. The form keeps its own second gate for a busy
  // machine picked by hand.
  const runningOps = useRunningOps({ status: 'running' });
  const [startElsewhere, setStartElsewhere] = useState(false);
  const plannedMachineId = isQc ? null : (target.machineId ?? op.machineId ?? null);
  const plannedBusy =
    !activeRunningId && plannedMachineId
      ? (runningOps.data?.find(
          (r) => r.machineId === plannedMachineId && !r.isOsp && r.jcOpId !== op.id,
        ) ?? null)
      : null;
  const showBusyPanel = Boolean(plannedBusy) && !startElsewhere;
  // Two facts, always: the plan, and the machine the open session is ACTUALLY
  // on (the one the pieces get stamped with). When the operator never changed
  // it, both read the same name — that is the answer, not a gap. Before a
  // session exists the Actual Machine picker inside the form decides it.
  // On the Start tab the actual is whatever the operator has picked so far —
  // the form reports it up — so the strip follows the picker live.
  const [pickedActual, setPickedActual] = useState<string | null>(null);
  const actual = activeRunningId
    ? (op.activeRunningMachineCode ?? planned)
    : isQc
      ? planned
      : (pickedActual ?? planned);
  // `CODE/REV` for the part, or '' when the join brought no item back. Empty
  // rather than a dash: a dash would read as "this card has no item", and every
  // job card has one.
  const itemCode = itemCodeWithRev(op.itemCode, op.itemRevision, '');

  // The title names what the box is actually for, read off the SESSION rather
  // than off what the caller asked for. A running operation cannot be started,
  // so it must never be headed "Start operation" -- which is exactly what a
  // stale ?mode=start used to do on IN-JC-26-00017 Op 1 while it was running.
  // A QC op has its own form inside and its own vocabulary, so it keeps its own
  // title rather than being called production either way.
  const title = showBusyPanel
    ? '⛔ Machine busy'
    : isQc
      ? '✔ QC inspection'
      : activeRunningId
        ? '✚ Log production'
        : '▶ Start operation';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — ${op.jobCardCode} Op ${fmtOpSrNo(op.opSeq)}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        overflowY: 'auto',
        zIndex: 60,
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 96vw)' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="fw-700" style={{ color: 'var(--cyan)' }}>
            {title}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* WHICH JOB — the whole reason this box exists. It comes before every
            field, not beside them, so the operation being logged is read before
            a single number is typed. */}
        <div
          style={{
            margin: 16,
            marginBottom: 0,
            padding: 12,
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 10,
          }}
        >
          <div>
            <div className="text3" style={{ fontSize: 9, letterSpacing: '.06em' }}>
              JOB CARD
            </div>
            <div className="mono fw-700 cyan" style={{ fontSize: 13 }}>
              {op.jobCardCode}
            </div>
          </div>
          {/* WHICH PART. The job card number above it says which JOB, and that is
              not the same question — an operator can read IN-JC-26-00017 back
              correctly and still be booking the wrong component, because the
              number carries no part in it. This is the box production is
              actually typed into, so the part belongs here more than anywhere
              else on the screen. It sits immediately after the job card because
              the two are read as one fact.

              Width: the panel is min(720px, 96vw) and the grid is auto-fit at
              minmax(110px, 1fr), so five facts still sit on one row on a
              shop-floor monitor (5 x 110 = 550 inside ~660px of content) and
              wrap by themselves on a phone. */}
          {itemCode || op.itemName ? (
            <div>
              <div className="text3" style={{ fontSize: 9, letterSpacing: '.06em' }}>
                ITEM
              </div>
              <div className="mono fw-700" style={{ fontSize: 13, color: 'var(--purple)' }}>
                {itemCode}
              </div>
              {/* The name is the only free-text value in the strip, so it is
                  held to one line with the whole of it on hover rather than
                  being allowed to make this fact three lines tall. */}
              {op.itemName ? (
                <div
                  className="text3"
                  style={{
                    fontSize: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={op.itemName}
                >
                  {op.itemName}
                </div>
              ) : null}
            </div>
          ) : null}
          <Fact label="OPERATION" value={`Op ${fmtOpSrNo(op.opSeq)} · ${op.operation}`} />
          <Fact label="PLANNED MACHINE" value={planned} />
          <Fact label="ACTUAL MACHINE" value={actual} />
          <div>
            <div className="text3" style={{ fontSize: 9, letterSpacing: '.06em' }}>
              AVAILABLE
            </div>
            <div className="mono fw-700 amber" style={{ fontSize: 15 }}>
              {op.available} pcs
            </div>
          </div>
        </div>

        {showBusyPanel && plannedBusy ? (
          /* MACHINE BUSY — shown INSTEAD of the Start form. Names the job and
             operation holding the planned machine and offers the ways on. */
          <div style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                padding: 14,
                background: 'var(--bg3)',
                border: '1px solid var(--amber)',
                borderRadius: 8,
              }}
            >
              <AlertTriangle size={22} className="amber" style={{ flex: 'none', marginTop: 2 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b className="mono">{planned}</b> is currently running{' '}
                <span className="mono fw-700 cyan">
                  {plannedBusy.jobCardCode} / Op {opSrNo(plannedBusy.opSeq)}
                </span>
                . This operation cannot start on it until that operation is completed or stopped —
                or start it on another machine.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-sm"
                title="Open the Start form with the Actual Machine left blank, to pick a free one"
                onClick={() => setStartElsewhere(true)}
              >
                ⚙ Start on another machine
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                title="Open the running operation to Complete or Stop it"
                onClick={() => {
                  void navigate({
                    to: '/op-entry',
                    search: (prev) => ({
                      ...prev,
                      jc: plannedBusy.jobCardCode,
                      op: plannedBusy.jcOpId,
                      mode: 'complete',
                      view: undefined,
                    }),
                  });
                  onClose();
                }}
              >
                ✚ Open Current Operation
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <OpEntryForm
              onActualMachineChange={setPickedActual}
              op={op}
              activeRunningId={activeRunningId}
              {...(onModeChange ? { onModeChange } : {})}
              // Close once the entry has actually landed. Leaving the box open on
              // a successful save invites a second identical submission, which on
              // a shop floor is how a quantity gets booked twice.
              onSubmitted={onClose}
              onClose={onClose}
              defaultMachineId={target.machineId ?? null}
              // "Start on another machine": the plan is busy, so it must not be
              // the pre-filled answer — the picker opens blank, in the plan's
              // group, and the operator names the free machine.
              startWithoutMachine={startElsewhere}
            />
          </div>
        )}
      </div>
    </div>
  );
}
