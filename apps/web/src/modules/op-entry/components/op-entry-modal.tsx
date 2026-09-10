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
import { X } from 'lucide-react';
import { OpEntryForm } from './op-entry-form';

/** What the popup was opened against. `mode` decides which half of the entry
 *  form shows first; the operator can still switch inside it. */
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
  const { op, activeRunningId, mode } = target;
  const isQc = op.opType === 'qc' || op.qcRequired;
  const machine = op.machineCode ?? op.machineCodeText ?? '—';

  // The title says what the operator pressed, so the box cannot be mistaken for
  // the one they meant to open. A QC op has its own form inside and its own
  // vocabulary, so it gets its own title rather than being called "production".
  const title = isQc
    ? '✔ QC inspection'
    : mode === 'start'
      ? '▶ Start operation'
      : '✚ Log production';

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
            mode={mode}
            {...(onModeChange ? { onModeChange } : {})}
            // Close once the entry has actually landed. Leaving the box open on
            // a successful save invites a second identical submission, which on
            // a shop floor is how a quantity gets booked twice.
            onSubmitted={onClose}
          />
        </div>
      </div>
    </div>
  );
}
