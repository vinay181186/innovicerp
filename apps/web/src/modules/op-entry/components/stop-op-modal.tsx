// "Stop the session" modal — shared by BOTH tabs of the Live Operations Board
// (the 📊 Table tab's running-ops-board and the 🏭 By Machine tab's
// shop-floor-view). It lives in op-entry because op-entry owns the endpoint
// (POST /op-entry/running-ops/:id/stop).
//
// Why it exists: Stop used to only mark the machine idle. Nothing was logged,
// so the op's Done stayed 0 and the NEXT operation never became workable — the
// operator had to remember to go to Op Entry afterwards, and of 8 sessions
// ended that way, 4 had no production logged at all. Stopping and logging what
// was made are now ONE action, and the entry it writes is an ordinary
// completion row: same log type, same machine stamp, same downstream cascades.
//
// EVERY FIELD STARTS BLANK AND NOTHING IS DEFAULTED — not the date, not the
// time, not the shift, not the operator, not the quantity. The old modal
// prefilled the quantity with the cap and asked for none of the other four,
// reading them off the running_ops row instead. That silently asserted things
// that are frequently untrue: a session started at 22:40 on the night shift by
// one operator is often stopped the next morning by a different one, and the
// entry then carried the wrong date, the wrong shift and the wrong name with
// nothing in the record to show it. Re-typing four fields costs the operator a
// few seconds; a production log nobody can trust costs far more. The person
// standing at the machine states the facts of THIS entry.
//
// Quantity 0 is a perfectly valid answer (a breakdown, a setup that never ran)
// and always goes through. What is blocked is an EMPTY quantity box — "nothing
// made" has to be said out loud rather than walked away from, which is exactly
// what used to happen.
//
// The cap ("you can log up to N") is shown BEFORE the operator types. Inviting
// a number the server will then refuse is the exact problem that was fixed on
// the OSP challan. It is advisory only — the server re-checks under a row lock
// and can still say no (QC pending, a lower client-material limit), and that
// refusal is shown in the error box below the fields.
//
// Shape lifted from purchase-requests/components/close-balance-modal.tsx: same
// overlay, same `.panel` body, same footer pair.

import { SHIFTS, SHIFT_LABELS, type Shift, type StopOpInput } from '@innovic/shared';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useOperatorsList } from '@/modules/operators/api';

/** The one row being stopped, flattened so both tabs can build it from their
 *  own row type (RunningOp on the Table tab, ShopFloorRunningRow on By
 *  Machine). */
export interface StopOpTarget {
  /** running_ops.id — the :id in the POST. */
  runningOpId: string;
  jobCardCode: string;
  /** WHAT was being made. The job card code above says WHICH JOB and nothing
   *  about which part, so the "is this the right row" check the box exists for
   *  was being asked without the one fact an operator recognises a job by.
   *
   *  OPTIONAL, all three, and deliberately so. Each tab flattens this target
   *  out of its own row type, and a required field would force a tab whose row
   *  does not carry the item to invent one — the `?? ''` or `?? '—'` that
   *  satisfies the compiler prints an item line asserting the part is unknown,
   *  which is a worse answer than silence on a box an operator is checking a
   *  row against. Omitted means "this caller does not know the part", and the
   *  box then shows no item line at all rather than an empty one. */
  itemCode?: string | null;
  /** The customer's drawing revision, rendered with the code as `CODE/REV`.
   *  Null is ordinary — a JW-sourced or standalone card has no SO line behind
   *  it — and those show the bare code, never a trailing slash. */
  itemRevision?: string | null;
  itemName?: string | null;
  opSeq: number;
  operation: string;
  /** Machine code, or 'OSP'/'—' when there is no machine. Display only. */
  machineLabel: string;
  /** v_jc_op_status.available for this op right now. NOT pendingQty. */
  availableQty: number;
}

/** Returns the whole number typed into a count box, or null when the box holds
 *  something that is not one. A BLANK box also returns null: blank no longer
 *  quietly means zero, because the operator has to state the quantity rather
 *  than have one assumed for them. Callers separate the two cases by testing
 *  the trimmed string themselves. */
function parseCount(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
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
  // Every one of these starts empty on purpose. See the note at the top of the
  // file — nothing here is inherited from the session or from the clock.
  const [logDate, setLogDate] = useState('');
  // Upper bound for the date box. NOT a default — the box still opens blank;
  // `max` only greys out the days after today in the native picker.
  // todayIst() is the same "today" the rest of the app uses, so a shop-floor
  // PC (which runs on IST, as the server records) greys out tomorrow onwards.
  // Read on each render so a modal left open past midnight moves with the
  // clock instead of freezing on yesterday.
  const maxLogDate = todayIst();
  const [logTime, setLogTime] = useState('');
  // '' is a real state, not a placeholder for 'day': the <select> opens on
  // "Select shift" so no shift is ever recorded by accident.
  const [shift, setShift] = useState<Shift | ''>('');
  const [qty, setQty] = useState('');
  const [rejectQty, setRejectQty] = useState('');
  const [remarks, setRemarks] = useState('');

  // Operator picker, identical to the one on the By Machine start strip and the
  // By Job Card entry form: free text always works, and an exact name/code
  // match resolves the operators-master FK so the entry links to a real person.
  const [operatorName, setOperatorName] = useState('');
  const [operatorId, setOperatorId] = useState<string | undefined>(undefined);
  const operatorsQuery = useOperatorsList({ isActive: true, limit: 200, offset: 0 });
  const operators = operatorsQuery.data?.operators ?? [];

  // `CODE/REV` for the part, or '' when this caller did not supply an item. ''
  // is tested rather than printed, so an unwired caller shows no item line at
  // all instead of an empty "Item" label or a dash that would read as "this job
  // has no part".
  const itemCode = itemCodeWithRev(target.itemCode, target.itemRevision, '');

  function handleOperatorNameChange(value: string): void {
    setOperatorName(value);
    const needle = value.trim().toLowerCase();
    const match = needle
      ? operators.find(
          (o) => o.name.trim().toLowerCase() === needle || o.code.trim().toLowerCase() === needle,
        )
      : undefined;
    setOperatorId(match ? match.id : undefined);
  }

  const qtyBlank = qty.trim() === '';
  const qtyNum = parseCount(qty);
  // Rejects are OPTIONAL, so a blank box legitimately means none.
  const rejBlank = rejectQty.trim() === '';
  const rejNum = rejBlank ? 0 : parseCount(rejectQty);

  // Junk in a box is a different complaint from an empty one, and gets its own
  // message so the operator is not told to "fill in Quantity" when they can see
  // they have typed something into it.
  const qtyIsJunk = !qtyBlank && qtyNum === null;
  const rejIsJunk = !rejBlank && rejNum === null;
  const overCap = qtyNum !== null && qtyNum > target.availableQty;
  // The picker's `max` greys future days out, but several browsers still let a
  // date be TYPED straight into the box, which is how a future entry got
  // booked in the first place. Both sides are `YYYY-MM-DD`, which compares
  // correctly as plain text. A blank box is not "in the future" — that case is
  // already covered by the missing-field list below.
  const dateInFuture = logDate !== '' && logDate > maxLogDate;

  // Mandatory: date, time, shift, operator, quantity. A quantity of 0 satisfies
  // this — an EMPTY box does not.
  const missing: string[] = [];
  if (!logDate) missing.push('Date');
  if (!logTime) missing.push('Time');
  if (!shift) missing.push('Shift');
  if (!operatorId && !operatorName.trim()) missing.push('Operator');
  if (qtyBlank) missing.push('Quantity made');

  const canSubmit =
    missing.length === 0 &&
    !qtyIsJunk &&
    !rejIsJunk &&
    !overCap &&
    !dateInFuture &&
    !pending &&
    qtyNum !== null;

  function handleStop(): void {
    if (!canSubmit || qtyNum === null || rejNum === null || !shift) return;
    onSubmit({
      qty: qtyNum,
      rejectQty: rejNum,
      logDate,
      logTime,
      shift,
      // One of these two is always present — the Operator field is mandatory
      // above, and the schema refuses a body carrying neither.
      ...(operatorId ? { operatorId } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    });
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
        style={{ width: 'min(520px, 96vw)' }}
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
            {/* The part, directly under the job card number, because "is this
                the right row" is the question this whole box is here to let the
                operator answer and the number alone does not answer it. One
                line with the full text on hover: this box is 520px wide and a
                wrapped part name would push the date field down. */}
            {itemCode ? (
              <div
                style={{
                  marginTop: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={target.itemName ? `${itemCode} — ${target.itemName}` : itemCode}
              >
                Item{' '}
                <b className="mono" style={{ color: 'var(--purple)' }}>
                  {itemCode}
                </b>
                {target.itemName ? <span className="text3"> — {target.itemName}</span> : null}
              </div>
            ) : null}
            <div className="text3" style={{ marginTop: 4 }}>
              Machine <b className="mono">{target.machineLabel}</b>
            </div>
          </div>

          {/* Date · Time · Shift on one wrapping row. Each form-grp carries an
              explicit width because .innovic-input is width:100% and would
              otherwise collapse in a flex row (same trick as op-entry-form). */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-grp" style={{ width: 150 }}>
              <label className="form-label" htmlFor="stop-op-date">
                Date <span className="req">★</span>
              </label>
              <input
                id="stop-op-date"
                className="innovic-input"
                type="date"
                max={maxLogDate}
                required
                value={logDate}
                autoFocus
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ width: 120 }}>
              <label className="form-label" htmlFor="stop-op-time">
                Time <span className="req">★</span>
              </label>
              <input
                id="stop-op-time"
                className="innovic-input"
                type="time"
                required
                value={logTime}
                onChange={(e) => setLogTime(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ width: 140 }}>
              <label className="form-label" htmlFor="stop-op-shift">
                Shift <span className="req">★</span>
              </label>
              <select
                id="stop-op-shift"
                className="innovic-select"
                required
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift | '')}
              >
                {/* First option is a placeholder, so nothing is pre-selected. */}
                <option value="">Select shift</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grp" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="stop-op-operator">
              Operator <span className="req">★</span>
            </label>
            <input
              id="stop-op-operator"
              className="innovic-input"
              list="stop-op-operator-list"
              required
              value={operatorName}
              onChange={(e) => handleOperatorNameChange(e.target.value)}
              placeholder="Operator name"
              autoComplete="off"
            />
            <datalist id="stop-op-operator-list">
              {operators.map((o) => (
                <option key={o.id} value={o.name}>
                  {o.code}
                  {o.department ? ` · ${o.department}` : ''}
                </option>
              ))}
            </datalist>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-grp" style={{ width: 150 }}>
              <label className="form-label" htmlFor="stop-op-qty">
                Quantity made <span className="req">★</span>
              </label>
              <input
                id="stop-op-qty"
                className="innovic-input"
                type="number"
                inputMode="numeric"
                required
                min={0}
                max={target.availableQty}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="Enter qty"
              />
            </div>
            <div className="form-grp" style={{ width: 150 }}>
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
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="form-grp" style={{ margin: 0 }}>
            <label className="form-label" htmlFor="stop-op-remarks">
              Remarks
            </label>
            <input
              id="stop-op-remarks"
              className="innovic-input"
              value={remarks}
              maxLength={500}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional — why the session stopped, tooling notes…"
            />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            You can log up to{' '}
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {target.availableQty}
            </b>{' '}
            pcs. Enter <b className="mono">0</b> if nothing was made in this session — the machine
            is still released. Fields marked <span style={{ color: 'var(--red)' }}>★</span> are
            required. {/* .req is scoped to .form-label, so this one is coloured inline. */}
          </div>

          {overCap ? (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Only {target.availableQty} pcs can be logged on this operation right now.
            </div>
          ) : null}
          {dateInFuture ? (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Date cannot be in the future — an operation cannot be worked on a day that has not
              happened yet.
            </div>
          ) : null}
          {qtyIsJunk || rejIsJunk ? (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>
              Enter whole numbers (0 or more) in {qtyIsJunk ? 'Quantity made' : 'Rejects'}.
            </div>
          ) : null}
          {/* Naming what is still empty, rather than just greying the button out
              and leaving the operator to hunt for the reason. */}
          {missing.length > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--amber)' }}>
              Still to fill in: <b>{missing.join(', ')}</b>.
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
