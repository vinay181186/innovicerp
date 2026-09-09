// "Stop the session" modal — shared by BOTH tabs of the Live Operations Board
// (the 📊 Table tab's running-ops-board and the 🏭 By Machine tab's
// shop-floor-view). It lives in op-entry because op-entry owns the endpoint
// (POST /op-entry/running-ops/:id/stop).
//
// Why it exists: Stop used to only mark the machine idle. Nothing was logged,
// so the op's Done stayed 0 and the NEXT operation never became workable — the
// operator had to remember to go to Op Entry afterwards, and of 8 sessions
// ended that way, 4 had no production logged at all. Stopping and logging what
// was made are now one action.
//
// Two shapes, deliberately:
//   * breakdown / nothing made -> clear the qty, press Stop. Nothing is posted
//     in the body, so the session ends exactly as it did before. Stop is NEVER
//     disabled for a 0 quantity: that case has to stay one click.
//   * finished a batch -> the qty is PREFILLED with the cap, so the common case
//     is also one click.
//
// The cap ("you can log up to N") is shown BEFORE the operator types. Inviting
// a number the server will then refuse is the exact problem that was fixed on
// the OSP challan. It is advisory only — the server re-checks under a row lock
// and can still say no (QC pending, a lower client-material limit), and that
// refusal is shown in the error box below the fields.
//
// Shape lifted from purchase-requests/components/close-balance-modal.tsx: same
// overlay, same `.panel` body, same footer pair.

import type { StopOpInput } from '@innovic/shared';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

/** The one row being stopped, flattened so both tabs can build it from their
 *  own row type (RunningOp on the Table tab, ShopFloorRunningRow on By
 *  Machine). */
export interface StopOpTarget {
  /** running_ops.id — the :id in the POST. */
  runningOpId: string;
  jobCardCode: string;
  opSeq: number;
  operation: string;
  /** Machine code, or 'OSP'/'—' when there is no machine. Display only. */
  machineLabel: string;
  /** v_jc_op_status.available for this op right now. NOT pendingQty. */
  availableQty: number;
}

/** '' counts as 0 — an operator clearing the box means "nothing made". */
function parseCount(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return 0;
  if (!/^\d+$/.test(t)) return null;
  return Number(t);
}

export function StopOpModal({
  target,
  pending,
  errorText,
  onCancel,
  onSubmit,
}: {
  target: StopOpTarget;
  pending: boolean;
  /** The server's own message when the stop was refused. */
  errorText: string | null;
  onCancel: () => void;
  onSubmit: (input: StopOpInput) => void;
}): React.JSX.Element {
  const [qty, setQty] = useState(String(target.availableQty));
  const [rejectQty, setRejectQty] = useState('0');

  const qtyNum = parseCount(qty);
  const rejNum = parseCount(rejectQty);
  const overCap = qtyNum !== null && qtyNum > target.availableQty;
  // Stop stays enabled at 0. It is only blocked by a number the server would
  // certainly refuse, or by junk typed into a box.
  const canSubmit = qtyNum !== null && rejNum !== null && !overCap && !pending;

  function handleStop(): void {
    if (!canSubmit || qtyNum === null || rejNum === null) return;
    // qty 0 posts an EMPTY body — byte for byte what Stop posted before this
    // modal existed. Rejects are only meaningful alongside a quantity (see the
    // note on stopOpInputSchema), so they ride along only when qty > 0.
    if (qtyNum <= 0) {
      onSubmit({});
      return;
    }
    onSubmit(rejNum > 0 ? { qty: qtyNum, rejectQty: rejNum } : { qty: qtyNum });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '10vh 16px',
        zIndex: 60,
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 96vw)' }}
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
          <div className="fw-700" style={{ color: 'var(--amber)' }}>
            ■ Stop operation
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          {/* What is being stopped, so the operator can see it is the right row. */}
          <div
            style={{
              background: 'var(--bg3)',
              padding: 12,
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text2)',
              lineHeight: 1.5,
            }}
          >
            <div>
              <b className="mono" style={{ color: 'var(--cyan)' }}>
                {target.jobCardCode}
              </b>{' '}
              · Op <b className="mono">{target.opSeq}</b> · {target.operation}
            </div>
            <div className="text3" style={{ marginTop: 4 }}>
              Machine <b className="mono">{target.machineLabel}</b>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-grp" style={{ width: 130 }}>
              <label className="form-label" htmlFor="stop-op-qty">
                Quantity made
              </label>
              <input
                id="stop-op-qty"
                className="innovic-input"
                type="number"
                inputMode="numeric"
                min={0}
                max={target.availableQty}
                value={qty}
                autoFocus
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="form-grp" style={{ width: 130 }}>
              <label className="form-label" htmlFor="stop-op-rej">
                Rejects
              </label>
              <input
                id="stop-op-rej"
                className="innovic-input"
                type="number"
                inputMode="numeric"
                min={0}
                value={rejectQty}
                onChange={(e) => setRejectQty(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            You can log up to{' '}
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {target.availableQty}
            </b>{' '}
            pcs. Leave the quantity at 0 to stop without logging any production.
          </div>

          {overCap ? (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Only {target.availableQty} pcs can be logged on this operation right now.
            </div>
          ) : null}
          {qtyNum === null || rejNum === null ? (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Enter whole numbers (0 or more).
            </div>
          ) : null}
          {qtyNum === 0 && rejNum !== null && rejNum > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
              Rejects are only recorded together with a quantity made — set a quantity above, or
              they will not be logged.
            </div>
          ) : null}

          {errorText ? (
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--red3)',
                border: '1px solid var(--sig-critical-bd)',
                borderRadius: 6,
                color: 'var(--red)',
                fontSize: 12,
              }}
            >
              {errorText}
            </div>
          ) : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canSubmit}
              onClick={handleStop}
            >
              {pending ? (
                <>
                  <Loader2 className="inline h-3 w-3 animate-spin" /> Stopping…
                </>
              ) : (
                'Stop'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
