// Partial / progressive Production Order close form (ADR-179).
//
// Replaces the old one-shot confirm. The person credits pieces AS THEY FINISH:
// a qty field defaults to and is capped at `availableToClose` (= live finished −
// already credited). A "Close short (finish)" toggle finishes the
// PO under target — it records the shortfall (order − credited) as lost and needs
// a reason. Whether close is allowed at all is still the server's call
// (`canClose` / `closeBlockedReason`); this form only renders once it is.
//
// Layout (pro-routecard-create-edit-mockup.html frame 3, approved 2026-10-06):
// the old running line became a four-cell account on the ClusterGrid —
// PRO Qty | JC Finished | Credited Qty | Available to Close (green result) —
// then Qty to Close★ and Remarks, with Pending and Lost Qty in the help line.
// Finish Short ticked: PRO Qty | Credited Qty | Available to Close | Lost Qty
// (orange), and Reason★ takes the whole row. Rules, messages, the Finish Short
// sentence and the button are unchanged. Used by the detail page's Close Qty…
// dialog and by routes/close.tsx.
//
// The qty is a plain <input type="number">; the app-wide wheel guard
// (lib/number-wheel-guard.ts) already stops the mouse wheel changing it, so no
// per-screen handler is needed (CLAUDE.md Section 16).

import type { ProductionOrderDetail } from '@innovic/shared';
import { Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Cluster, ClusterFact, ClusterGrid, FormField } from '@/ui/forms';
import { useCloseProductionOrder } from '../api';
import './po-edit.css';

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
        onError: (e) =>
          setError(
            e instanceof Error ? e.message : 'Could not close the Production Order. Try again.',
          ),
      },
    );
  };

  // The account's figures, worked out once so the cells, the help lines, the
  // Finish Short sentence and the button title can never disagree.
  const credited = po.creditedQty ?? 0;
  // What Finish Short writes off: Pending less what is credited now — exactly
  // the sum the Finish Short sentence below has always used.
  const lostOnFinish = Math.max(0, po.remainingQty - po.availableToClose);
  // Recomputed from the TYPED qty (cluster-grid pitfall 4): Pending is the
  // server's figure for what is credited so far, so it must drop as you type.
  const pendingAfter = Math.max(0, po.remainingQty - (qtyValid ? qtyNum : 0));
  // "40 − 20 credited − 8 credited now = 12" — printed only when that sum is
  // the Lost Qty the cell shows; otherwise just the figure.
  const lostSum =
    po.orderQty - credited - po.availableToClose === lostOnFinish
      ? `${po.orderQty} − ${credited} credited − ${po.availableToClose} credited now = ${lostOnFinish} recorded as lost`
      : `${lostOnFinish} recorded as lost`;

  return (
    <div className="po-close-form">
      <ClusterGrid>
        {/* The account, ending on the figure this close acts on. Ordinary
            close: PRO Qty → JC Finished → Credited → Available to Close
            (JC Finished − Credited). Finish Short: the account ends on the
            Lost Qty that will be written off instead. */}
        {finish ? (
          <Cluster>
            <ClusterFact num label="PRO Qty" value={po.orderQty} />
            <ClusterFact num label="Credited Qty" value={credited} />
            <ClusterFact num label="Available to Close" value={po.availableToClose} />
            <ClusterFact
              num
              className="po-lost"
              label="Lost Qty"
              title="Recorded as lost when this order is finished short"
              value={lostOnFinish}
            />
          </Cluster>
        ) : (
          <Cluster>
            <ClusterFact num label="PRO Qty" value={po.orderQty} />
            <ClusterFact num label="JC Finished" value={po.jcFinishedQty} />
            <ClusterFact num label="Credited Qty" value={credited} />
            <ClusterFact
              num
              lead
              label="Available to Close"
              title="Finished on the Job Card and not yet credited"
              value={po.availableToClose}
            />
          </Cluster>
        )}

        <Cluster>
          {/* Qty applies only to an ordinary partial close. On "Close short
              (finish)" the backend ignores it (it credits everything available
              and writes off the rest), so the field is hidden to avoid implying
              it is editable. */}
          {finish ? null : (
            <FormField
              label="Qty to Close"
              required
              htmlFor={`close-qty-${po.id}`}
              help={`Credited to stock · 1 to ${max}`}
            >
              <input
                id={`close-qty-${po.id}`}
                type="number"
                className="innovic-input cl-num cl-cap"
                min={1}
                max={max}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </FormField>
          )}

          <FormField
            className={finish ? 'cl-span-4' : 'cl-span-3'}
            label={finish ? 'Reason' : 'Remarks'}
            required={finish}
            htmlFor={`close-remarks-${po.id}`}
            help={
              finish
                ? lostSum
                : `Pending after this close: ${pendingAfter} · Lost Qty so far: ${po.lostQty ?? 0}`
            }
          >
            <input
              id={`close-remarks-${po.id}`}
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={finish ? 'e.g. 3 pieces scrapped at final inspection' : 'Optional note…'}
            />
          </FormField>
        </Cluster>
      </ClusterGrid>

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
          <b style={{ color: 'var(--amber2)' }}>Finish Short</b>
          <span className="text3">
            {' '}
            — finish now: the {po.availableToClose} ready are credited, the other{' '}
            {Math.max(0, po.remainingQty - po.availableToClose)} of {po.orderQty} are recorded as
            lost.
          </span>
        </span>
      </label>

      {!remarksValid ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          Reason is required.
        </div>
      ) : null}
      {!finish && !qtyValid && qty.trim() !== '' ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          Qty to Close must be a whole number from 1 to {max}.
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 10,
            color: 'var(--red2)',
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
              ? `Finish ${po.code}: credit the ${po.availableToClose} available, record ${Math.max(0, po.remainingQty - po.availableToClose)} lost`
              : `Credit ${qtyValid ? qtyNum : 0} of ${po.availableToClose} to stock`
          }
        >
          {closeMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}{' '}
          {finish ? 'Finish Short' : 'Close'}
        </button>
      </div>
    </div>
  );
}
