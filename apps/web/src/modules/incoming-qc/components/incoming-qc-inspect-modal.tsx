// The "🔬 Inspect" popup on the Incoming QC page.
//
// Pressing Inspect used to leave the page for the QC Call Register with
// ?line=<grnLineId>, which expanded the row there. The inspector was then two
// screens away from the queue they were working through. This box opens the
// SAME form over the queue instead, and the queue is still there when it
// closes.
//
// It deliberately OWNS no entry logic. The body is `IncomingQcInspectForm`,
// the very component the register's expanded row draws, so the fields, the
// validation messages, the POST body, the cache invalidations and the
// post-submit reset are one piece of code in one place. This file only gives
// that form a heading, a way to close, and the "are you sure?" that every
// modal form in the app asks when something typed would be lost.
//
// Shape follows op-entry/components/op-entry-modal.tsx: same overlay, same
// `.panel` body, same close button. zIndex 60 — BELOW the SearchableSelect
// listbox (1000) so the QC By dropdown still shows on top, and below the
// ExitConfirmDialog (600) so the question sits over the form it asks about.

import type { IncomingQcPendingRow } from '@innovic/shared';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { IncomingQcInspectForm } from './incoming-qc-inspect-form';

export function IncomingQcInspectModal({
  o,
  onClose,
}: {
  o: IncomingQcPendingRow;
  onClose: () => void;
}): React.JSX.Element {
  // Whether anything has been typed or attached — reported up by the form.
  // Decides if closing asks first.
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_incoming').entry;

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
  const ariaLabel = `Incoming QC — ${o.grnNo}${itemCode ? ` · ${itemCode}` : ''}`;

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
          {/* WHICH LINE — stated before a single field, so the GRN and the
              part being accepted are read before any number is typed. */}
          <div
            className="fw-700"
            style={{
              color: 'var(--cyan)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={`${o.grnNo}${itemCode ? ` · ${itemCode}` : ''}${o.itemName ? ` · ${o.itemName}` : ''}`}
          >
            🔬 Incoming QC — <span className="mono">{o.grnNo}</span>
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
                · {o.itemName}
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
          <IncomingQcInspectForm
            o={o}
            onCancel={requestClose}
            // Close once the entry has actually landed. The form has already
            // reset itself and the queue refetches behind the box.
            onDone={onClose}
            onDirtyChange={setDirty}
          />
        ) : eff ? (
          /* View-only: the same silence the register keeps (no form drawn),
             said once here because an empty popup would read as broken. Not
             shown while access is still loading, or every inspector would see
             it flash. */
          <div className="empty-state text3" style={{ padding: 24, fontSize: 12 }}>
            Your access lets you view this queue but not record an inspection.
          </div>
        ) : null}
      </div>
    </div>
  );
}
