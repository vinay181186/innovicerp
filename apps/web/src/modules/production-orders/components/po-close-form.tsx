// Partial / progressive Production Order close form (ADR-179).
//
// Replaces the old one-shot confirm. The person credits pieces AS THEY FINISH:
// a qty field defaults to and is capped at `availableToClose` (= live finished −
// already credited), and the running "Credited X of order, remaining Y" is shown
// so it is clear how much is left. A "Close short (finish)" toggle finishes the
// PO under target — it records the shortfall (order − credited) as lost and needs
// a reason. Whether close is allowed at all is still the server's call
// (`canClose` / `closeBlockedReason`); this form only renders once it is.
//
// The qty is a plain <input type="number">; the app-wide wheel guard
// (lib/number-wheel-guard.ts) already stops the mouse wheel changing it, so no
// per-screen handler is needed (CLAUDE.md Section 16).

import type { ProductionOrderDetail } from '@innovic/shared';
import { Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCloseProductionOrder } from '../api';

interface PoCloseFormProps {
  po: ProductionOrderDetail;
  /** Called with the refreshed order after a successful close. */
  onClosed?: (closed: ProductionOrderDetail) => void;
  /** Compact variant for the detail header (smaller controls). */
  compact?: boolean;
}

export function PoCloseForm({ po, onClosed, compact }: PoCloseFormProps): React.JSX.Element | null {
  const closeMut = useCloseProductionOrder();
  const [qty, setQty] = useState<string>(String(po.availableToClose));
  const [finish, setFinish] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The order refetches a lower availableToClose after each partial close while
  // this form stays mounted (detail page). Re-seed the qty field to the new
  // ceiling so it never keeps a now-too-high value that silently blocks submit.
  const max = po.availableToClose;
  useEffect(() => {
    setQty(String(max));
    // Keyed on the order + its available ceiling; a fresh order or a new
    // ceiling both reset the field.
  }, [po.id, max]);

  // Server decides whether close is allowed at all; the caller shows the reason.
  if (!po.canClose) return null;

  const qtyNum = Number(qty);
  const qtyValid = Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= max;
  // Finishing short must carry a reason (why the pieces were lost / not made).
  const remarksValid = !finish || remarks.trim().length > 0;
  // Close short: the backend ignores qty on finish — it credits ALL currently
  // available pieces and writes off only the never-made remainder — so the qty
  // field is not gated (it may even be 0 available). An ordinary partial close
  // still needs a valid qty in [1, available].
  const canSubmit = (finish ? remarksValid : qtyValid) && !closeMut.isPending;

  const onSubmit = (): void => {
    if (!canSubmit) return;
    setError(null);
    closeMut.mutate(
      {
        id: po.id,
        input: finish
          ? { finish: true, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) }
          : { qty: qtyNum, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) },
      },
      {
        onSuccess: (closed) => onClosed?.(closed),
        onError: (e) => setError(e instanceof Error ? e.message : 'Close failed.'),
      },
    );
  };

  return (
    <div>
      {/* Running counts — how much can be closed now, how much has been, how
          much is left. */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          fontSize: 12,
          marginBottom: 10,
          color: 'var(--text2)',
        }}
      >
        <span>
          Available to close{' '}
          <b className="mono" style={{ color: 'var(--text)' }}>
            {po.availableToClose}
          </b>
        </span>
        <span>
          Credited so far{' '}
          <b className="mono" style={{ color: 'var(--text)' }}>
            {po.creditedQty ?? 0}
          </b>{' '}
          of{' '}
          <b className="mono" style={{ color: 'var(--text)' }}>
            {po.orderQty}
          </b>
        </span>
        <span>
          Remaining{' '}
          <b className="mono" style={{ color: 'var(--text)' }}>
            {po.remainingQty}
          </b>
        </span>
      </div>

      <div className="form-grid form-grid-3">
        {/* Qty applies only to an ordinary partial close. On "Close short
            (finish)" the backend ignores it (it credits everything available
            and writes off the rest), so the field is hidden to avoid implying
            it is editable. */}
        {finish ? null : (
          <div className="form-grp">
            <label className="form-label" htmlFor={`close-qty-${po.id}`}>
              Qty to close now<span className="req">★</span>
            </label>
            <input
              id={`close-qty-${po.id}`}
              type="number"
              className="innovic-input mono"
              min={1}
              max={max}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ textAlign: 'right' }}
            />
            <div className="form-help">
              Defaults to all {max} available. Credits this many pieces to stock.
            </div>
          </div>
        )}

        <div className={finish ? 'form-grp form-full' : 'form-grp form-span-2'}>
          <label className="form-label" htmlFor={`close-remarks-${po.id}`}>
            {finish ? 'Reason for finishing short' : 'Remarks'}
            {finish ? <span className="req">★</span> : null}
          </label>
          <input
            id={`close-remarks-${po.id}`}
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              finish ? 'e.g. 3 pieces scrapped at final inspection' : 'Optional note…'
            }
          />
        </div>
      </div>

      {/* Close short: finish the PO under target. Records order − credited as
          lost stock, credits whatever is available now, and closes the order. */}
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          marginTop: 10,
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={finish}
          onChange={(e) => {
            setFinish(e.target.checked);
            setError(null);
          }}
          style={{ marginTop: 2 }}
        />
        <span>
          <b style={{ color: 'var(--amber)' }}>Close short (finish)</b>
          <span className="text3">
            {' '}
            — finish this Production Order now even though {po.remainingQty} of {po.orderQty} are
            not made. The shortfall is recorded as lost; give the reason above.
          </span>
        </span>
      </label>

      {!remarksValid ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          A reason is required when finishing short.
        </div>
      ) : null}
      {!finish && !qtyValid && qty.trim() !== '' ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          Enter a whole qty between 1 and {max}.
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 10,
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          type="button"
          className={finish ? 'btn btn-primary' : 'btn btn-success'}
          disabled={!canSubmit}
          onClick={onSubmit}
          style={compact ? { padding: '4px 10px' } : undefined}
          title={
            finish
              ? `Finish ${po.code}: credit the ${po.availableToClose} available, record ${po.remainingQty} lost`
              : `Credit ${qtyValid ? qtyNum : 0} of ${po.availableToClose} to stock`
          }
        >
          {closeMut.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Lock size={14} />
          )}{' '}
          {finish ? 'Close short (finish)' : 'Close'}
        </button>
      </div>
    </div>
  );
}
