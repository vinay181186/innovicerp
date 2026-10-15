// Short Close — the ADR-182 "stop this order" dialog.
//
// It is NOT ADR-179's "close short" (which finishes a COMPLETE Job Card and
// writes off its losses). This one abandons the order wherever it stands:
//
//   • nothing is put into stock and no Stock Received is taken back;
//   • the order AND its Job Card are frozen — no Op Entry, no QC, no NC, no
//     OSP step, no edit. The server refuses every one of them;
//   • the un-produced qty goes back to the plan's Pending, so a fresh
//     Production Order can be raised for it.
//
// The reason is mandatory — the database CHECK refuses a short close without
// one, so the button stays off until something is typed.

import type { ProductionOrderStatus } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '@/ui/feedback';
import { useShortCloseProductionOrder } from '../api';

export function PoShortCloseModal({
  id,
  code,
  jcCode,
  orderQty,
  creditedQty,
  status,
  onClose,
}: {
  id: string;
  code: string;
  jcCode: string;
  orderQty: number;
  /** `Stock Received` — pieces already put into stock. They STAY in stock. */
  creditedQty: number;
  /** The order's status now. A `closed` order (Finish Short) already covers
   *  only its Stock Received on the plan, so nothing goes back to Pending. */
  status: ProductionOrderStatus;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const shortClose = useShortCloseProductionOrder();
  const trimmed = reason.trim();
  // ADR-233 `Short Closed Qty` once this is done = Order − Stock Received
  // (productionOrderShortClosedQty on a short_closed order).
  const stopping = Math.max(0, orderQty - creditedQty);
  // What the plan's Pending gains (server: shiftPlanPending) — only an order
  // still open or partly closed gives its balance back.
  const backToPlan = status === 'closed' ? 0 : stopping;

  const onSubmit = (): void => {
    setErr(null);
    if (!trimmed) {
      setErr('Reason is required.');
      return;
    }
    shortClose.mutate(
      { id, input: { reason: trimmed } },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(
            e instanceof Error
              ? e.message
              : 'Could not Short Close this Production Order. Try again.',
          ),
      },
    );
  };

  return (
    <Modal
      title={`Short Close ${code}`}
      size="sm"
      onClose={() => {
        // Always a function: `ModalProps.onClose` is required and handing it
        // `undefined` breaks the build under exactOptionalPropertyTypes. The
        // "cannot close mid-flight" rule lives inside instead, next to the
        // disabled Cancel button and closeOnOverlayClick={false}.
        if (!shortClose.isPending) onClose();
      }}
      closeOnOverlayClick={false}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={shortClose.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onSubmit}
            disabled={!trimmed || shortClose.isPending}
            title={!trimmed ? 'Type the reason first' : 'Stop this Production Order'}
          >
            {shortClose.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Short
            Close {stopping} pcs
          </button>
        </>
      }
    >
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
        This stops the order for good. Job Card{' '}
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {jcCode}
        </span>{' '}
        is frozen — no entry or edit is allowed on it afterwards.
        <div style={{ marginTop: 8 }}>
          <b style={{ color: 'var(--orange2)' }}>
            {stopping} of {orderQty} will be short-closed
          </b>{' '}
          (not produced). {creditedQty} stay in stock.{' '}
          {backToPlan > 0
            ? `${backToPlan} go back to the plan as Pending.`
            : 'The plan does not change — this order already counts only its stock.'}
        </div>
      </div>

      <div className="form-grp" style={{ marginTop: 14 }}>
        <label className="form-label" htmlFor="po-short-close-reason">
          Reason<span className="req">★</span>
        </label>
        <textarea
          id="po-short-close-reason"
          className="innovic-input"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this order being stopped?"
        />
      </div>

      {err ? (
        <div role="alert" className="form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
