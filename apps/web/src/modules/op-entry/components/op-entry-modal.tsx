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
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useJcOpsEnriched, useRunningOps } from '../api';
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
  // "Open Current Operation" on the Machine-busy panel re-points THIS popup at
  // the op actually running on the machine, in Log-production mode — the exact
  // box the operator would have reached had they clicked that running op. It is
  // local state, not a new route, so every caller (Job Card page, Job Queue,
  // By-Machine, By-JC, deep link) gets the same behaviour through the one modal.
  const [override, setOverride] = useState<OpEntryModalTarget | null>(null);
  const { op, activeRunningId } = override ?? target;
  const isQc = op.opType === 'qc' || op.qcRequired;
  const machine = op.machineCode ?? op.machineCodeText ?? '—';

  // MACHINE-BUSY GATE. Starting an op inserts a running_ops row, and a partial
  // unique index refuses a second running op on the same non-OSP machine — the
  // "machine busy" ConflictError. That refusal used to arrive only AFTER the
  // operator filled and submitted the Start form. Catch it up front instead:
  // the moment the Start box would open, look for another op already running on
  // this op's machine, and if there is one show the busy notice in place of the
  // form. Only relevant when THIS op is not itself running (activeRunningId is
  // null → Start) and it is a real machine op (OSP holds no machine lock).
  // A JcOpEnriched names its machine by CODE (`machine`, above); the running_ops
  // row carries the machine's id as well. Match on the code an operator would
  // read — unique in the machine master — and reuse the id off the running row
  // for the retarget query below.
  const machineKey = op.machineCode ?? op.machineCodeText ?? null;
  const runningOps = useRunningOps({ status: 'running' });
  const busy =
    !activeRunningId && machineKey
      ? (runningOps.data?.find(
          (r) => r.machineCode === machineKey && !r.isOsp && r.jcOpId !== op.id,
        ) ?? null)
      : null;
  // The running op as a full row, fetched only when the machine is busy, so
  // "Open Current Operation" can hand OpEntryForm the JcOpEnriched it needs.
  // Keyed by the running row's machineId; on a free machine this never fires.
  const machineOps = useJcOpsEnriched(busy?.machineId ? { machineId: busy.machineId } : {});
  const currentOp = busy ? (machineOps.data?.find((o) => o.id === busy.jcOpId) ?? null) : null;
  const showBusy = Boolean(busy) && !override;
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
  const title = showBusy
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
      aria-label={`${title} — ${op.jobCardCode} Op ${op.opSeq}`}
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>

        {showBusy && busy ? (
          /* MACHINE BUSY — shown instead of the Start form. Names the job and
             operation holding the machine, and offers the one action that
             unblocks the operator: open that running op's Log-production box,
             where Complete or Stop frees the machine through the existing
             workflow. No new screen, no second start path. */
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
                This machine is currently running{' '}
                <span className="mono fw-700 cyan">
                  {busy.jobCardCode} / Op {busy.opSeq}
                </span>
                . You cannot start this operation until the current operation is completed
                or stopped.
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!currentOp}
                title={
                  currentOp
                    ? 'Open the running operation to Complete or Stop it'
                    : 'Loading the running operation…'
                }
                onClick={() => {
                  if (!currentOp) return;
                  // Re-point THIS popup at the running op in Log-production mode.
                  // activeRunningId comes off the running op's own row, so the
                  // form shows Complete and Stop, exactly as ✚ Log would.
                  setOverride({
                    op: currentOp,
                    activeRunningId: currentOp.activeRunningOpId ?? busy.id,
                    mode: 'complete',
                  });
                }}
              >
                ✚ Open Current Operation
              </button>
            </div>
          </div>
        ) : (
          <>
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
          <Fact label="OPERATION" value={`Op ${op.opSeq} · ${op.operation}`} />
          <Fact label="MACHINE" value={machine} />
          <div>
            <div className="text3" style={{ fontSize: 9, letterSpacing: '.06em' }}>
              AVAILABLE
            </div>
            <div className="mono fw-700 amber" style={{ fontSize: 15 }}>
              {op.available} pcs
            </div>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          <OpEntryForm
            op={op}
            activeRunningId={activeRunningId}
            {...(onModeChange ? { onModeChange } : {})}
            // Close once the entry has actually landed. Leaving the box open on
            // a successful save invites a second identical submission, which on
            // a shop floor is how a quantity gets booked twice.
            onSubmitted={onClose}
          />
        </div>
          </>
        )}
      </div>
    </div>
  );
}
