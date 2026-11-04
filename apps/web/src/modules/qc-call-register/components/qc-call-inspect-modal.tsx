// The QC entry popup on the QC Call Register, for an in-process / final
// inspection call (a job-card operation awaiting QC).
//
// The pending row used to expand inline into the accept/reject form. It now
// opens this box over the register instead — the same shape as Op Entry's
// OpEntryModal and Incoming QC's IncomingQcInspectModal — so the queue stays
// where it was and the form always has the same room whatever row it belongs
// to.
//
// It deliberately OWNS no entry logic. The body is `QcCallInspectForm`
// (qc-call-inspect-form.tsx), which holds the fields, the validation messages,
// the POST body and the cache invalidations. This file only gives that form a
// heading and the one shared Modal shell (closing rule, Esc, focus, scroll lock).
//
// `confirmExit` follows the form's own dirty report, not just "something was
// typed": once an entry is saved and the popup holds on its upload-later note,
// nothing is left to lose. The form's Cancel sits in the BODY, which the Modal's
// footer rule does not reach, so that one button asks here.

import { type QcHistoryPendingRow, type QcSourceStep, opSrNo } from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { QtyStrip } from '@/ui/data';
import { Modal } from '@/ui/feedback';
import { actualMachineText, plannedMachineText, stepOpLabel } from './qc-call-fact-columns';
import { QcCallInspectForm, type RaisedNc } from './qc-call-inspect-form';

/** The step under inspection — "Inspecting step | Planned Machine | Actual
 *  Machine" — read before any qty is typed. Same wording as the register's
 *  Planned / Actual Machine columns. */
function StepFacts({ step }: { step: QcSourceStep | null }): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-4)', borderBottom: '1px solid var(--border)' }}>
      <QtyStrip
        items={[
          { label: 'Inspecting step', value: step ? stepOpLabel(step) : '— first step' },
          { label: 'Planned Machine', value: plannedMachineText(step) || '—' },
          { label: 'Actual Machine', value: actualMachineText(step) || '—' },
        ]}
      />
    </div>
  );
}

export function QcCallInspectModal({
  o,
  step,
  onClose,
  onNcRaised,
}: {
  o: QcHistoryPendingRow;
  /** The register item's sourceStep (the step whose output is inspected). */
  step?: QcSourceStep | null | undefined;
  onClose: () => void;
  /** A reject raised an NC — the register shows it with a link (ADR-190). */
  onNcRaised?: ((nc: RaisedNc) => void) | undefined;
}): React.JSX.Element {
  // Whether anything has been typed or attached — reported up by the form.
  const [dirty, setDirty] = useState(false);
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_submit').entry;

  const itemCode = itemCodeWithRev(o.itemCode, o.itemRevision, '');
  const opLabel = `Op ${opSrNo(o.opSeq)} ${o.operation}`;
  const titleText = `${o.jcCode} · ${opLabel}${itemCode ? ` · ${itemCode}` : ''}${
    o.itemName ? ` ${o.itemName}` : ''
  }`;

  return (
    <Modal
      title={
        <>
          {/* WHICH CALL — stated before a single field, so the job card, the
              operation and the part being passed are read before any number
              is typed. */}
          <div
            className="fw-700"
            style={{
              color: 'var(--cyan)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={titleText}
          >
            🔬 QC Call —{' '}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {o.jcCode}
            </span>
            <span className="text2" style={{ fontWeight: 600 }}>
              {' '}
              · {opLabel}
            </span>
            {itemCode ? (
              <>
                {' '}
                ·{' '}
                <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {itemCode}
                </span>
              </>
            ) : null}
            {o.itemName ? (
              <span className="text2" style={{ fontWeight: 600 }}>
                {' '}
                {o.itemName}
              </span>
            ) : null}
          </div>
        </>
      }
      onClose={onClose}
      maxWidth="min(760px, 96vw)"
      bodyStyle={{ padding: 0 }}
      confirmExit={dirty}
    >
      <StepFacts step={step ?? null} />

      {canEntry ? (
        <QcCallInspectForm
          o={o}
          onCancel={onClose}
          // Close once the entry has actually landed. The register refetches
          // behind the box (the form invalidates its feed on success).
          onDone={(nc) => {
            if (nc) onNcRaised?.(nc);
            onClose();
          }}
          onDirtyChange={setDirty}
        />
      ) : eff ? (
        /* View-only: the same silence the register keeps (no form drawn),
             said once here because an empty popup would read as broken. Not
             shown while access is still loading, or every inspector would see
             it flash. */
        <div
          className="empty-state text3"
          style={{ padding: 'var(--sp-5)', fontSize: 'var(--fs-xs)' }}
        >
          You do not have permission to inspect this QC call. Ask an admin.
        </div>
      ) : null}
    </Modal>
  );
}
