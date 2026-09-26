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
// heading, a way to close, and the "are you sure?" that every modal form in
// the app asks when something typed would be lost.
//
// Shape cloned from incoming-qc/components/incoming-qc-inspect-modal.tsx: same
// overlay, same `.panel` body, same close button. zIndex 60 — BELOW the
// SearchableSelect listbox (1000) so the QC By dropdown still shows on top,
// and below the ExitConfirmDialog (600) so the question sits over the form it
// asks about.

import { type QcHistoryPendingRow, opSrNo } from '@innovic/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { QcCallInspectForm, type RaisedNc } from './qc-call-inspect-form';

export function QcCallInspectModal({
  o,
  onClose,
  onNcRaised,
}: {
  o: QcHistoryPendingRow;
  onClose: () => void;
  /** A reject raised an NC — the register shows it with a link (ADR-190). */
  onNcRaised?: ((nc: RaisedNc) => void) | undefined;
}): React.JSX.Element {
  // Whether anything has been typed or attached — reported up by the form.
  // Decides if closing asks first.
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_submit').entry;

  // Every way out that is not a successful submit goes through here: ESC,
  // click on the dim background, the ✕, the form's own Cancel. Clean form →
  // close at once; anything typed → ask.
  const requestClose = useCallback((): void => {
    if (dirty) setConfirmOpen(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // ESC with a type-to-search dropdown open is that dropdown's key.
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      // The exit question already has the keyboard; its own ESC means "stay".
      if (confirmOpen) return;
      requestClose();
    }
    // CAPTURE phase, on purpose. The picker's own onKeyDown (React root
    // listener, bubble) closes its list and React flushes that before a
    // bubble listener here would run — so by then the input already reads
    // aria-expanded="false" and the guard above would fall through, closing
    // the popup on the very ESC meant for the list. Capture at document runs
    // BEFORE React's root listener, while the list is still open.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirmOpen, requestClose]);

  // The page behind must not scroll while the box is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const itemCode = itemCodeWithRev(o.itemCode, o.itemRevision, '');
  const opLabel = `Op ${opSrNo(o.opSeq)} ${o.operation}`;
  const titleText = `${o.jcCode} · ${opLabel}${itemCode ? ` · ${itemCode}` : ''}${
    o.itemName ? ` ${o.itemName}` : ''
  }`;
  const ariaLabel = `QC Call — ${titleText}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => {
        // Only the dim backdrop itself -- not the popup rendered inside it.
        if (e.target === e.currentTarget) requestClose();
      }}
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
      {confirmOpen ? (
        <ExitConfirmDialog
          onStay={() => setConfirmOpen(false)}
          onExit={() => {
            setConfirmOpen(false);
            onClose();
          }}
        />
      ) : null}
      <div className="panel" style={{ width: 'min(760px, 96vw)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={requestClose}
            aria-label="Close"
            style={{ flex: 'none' }}
          >
            <X size={14} />
          </button>
        </div>

        {canEntry ? (
          <QcCallInspectForm
            o={o}
            onCancel={requestClose}
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
          <div className="empty-state text3" style={{ padding: 24, fontSize: 12 }}>
            You do not have permission to inspect this QC call. Ask an admin.
          </div>
        ) : null}
      </div>
    </div>
  );
}
