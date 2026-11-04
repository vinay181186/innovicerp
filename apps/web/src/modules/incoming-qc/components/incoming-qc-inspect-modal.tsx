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
// that form a heading and the one shared Modal shell (closing rule, Esc, focus,
// scroll lock).
//
// `confirmExit` follows the form's own dirty report. The form's Cancel sits in
// the BODY, which the Modal's footer rule does not reach, so that one button
// asks here.

import { type IncomingQcPendingRow, opSrNo } from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { Modal } from '@/ui/feedback';
import { IncomingQcInspectForm, type IncomingRaisedNc } from './incoming-qc-inspect-form';

export function IncomingQcInspectModal({
  o,
  onClose,
  onNcRaised,
}: {
  o: IncomingQcPendingRow;
  onClose: () => void;
  /** A reject raised an NC — the host shows "NC … raised — Dispose now →". */
  onNcRaised?: ((nc: IncomingRaisedNc) => void) | undefined;
}): React.JSX.Element {
  // Whether anything has been typed or attached — reported up by the form.
  const [dirty, setDirty] = useState(false);
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_incoming').entry;

  const itemCode = itemCodeWithRev(o.itemCode, o.itemRevision, '');

  return (
    <Modal
      title={
        <>
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
            title={`${o.grnNo}${o.clientPoLineNo ? ` · POL ${o.clientPoLineNo}` : ''}${itemCode ? ` · ${itemCode}` : ''}${o.itemName ? ` · ${o.itemName}` : ''}`}
          >
            🔬 Incoming QC — <span className="mono">{o.grnNo}</span>
            {/* POL — the customer's own PO line number, before the item code. */}
            {o.clientPoLineNo ? (
              <>
                {' '}
                · POL{' '}
                <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
                  {o.clientPoLineNo}
                </span>
              </>
            ) : null}
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
            {o.jcCode ? (
              <span className="text2" style={{ fontWeight: 600 }}>
                {' '}
                · {o.jcCode} Op {o.opSeq != null ? opSrNo(o.opSeq) : ''}
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
      {canEntry ? (
        <IncomingQcInspectForm
          o={o}
          onCancel={onClose}
          // Close once the entry has actually landed. The form has already
          // reset itself and the queue refetches behind the box.
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
          You do not have permission to inspect this GRN line. Ask an admin.
        </div>
      ) : null}
    </Modal>
  );
}
