// Allocate / Release stock against an SO line (ADR-180).
//
// A reservation is a BOOKING, not a stock move. Three numbers, and the UI uses
// exactly these three words:
//   PHYSICAL  — what is on the shelf (never changes when you allocate)
//   RESERVED  — promised to SO lines but still on the shelf
//   AVAILABLE — Physical − Reserved
//
// Allocate caps the qty at min(Available, Order − Dispatched − already reserved
// to THIS line) and refuses 0 or less. Release needs a reason: giving stock
// back is a decision someone has to own, so the button stays disabled until one
// is typed.
//
// Both boxes are the shared so-planning `Modal`, so ESC / click-outside ask
// before throwing away what was typed.

import type { PlanningLine, ReservationActionResult } from '@innovic/shared';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { useReleaseReservations, useReserveStock, useStockAvailability } from '@/modules/plans/api';
import { Modal } from './modal';

/** Everything either box needs about the line it is acting on. */
export interface StockLineFacts {
  soLineId: string;
  soCode: string;
  lineNo: number;
  itemId: string | null;
  /** `CODE/REV` — the customer's drawing revision where there is one. */
  itemLabel: string;
  itemName: string | null;
  orderQty: number;
  dispatchedQty: number;
  physicalQty: number;
  /** Reserved to EVERY line — the committed total for this item. */
  totalReservedQty: number;
  /** Reserved to THIS line. */
  reservedQty: number;
  availableQty: number;
}

/** Build the facts from a planning line — the one place the mapping lives. */
export function lineFacts(soCode: string, line: PlanningLine): StockLineFacts {
  return {
    soLineId: line.soLineId,
    soCode,
    lineNo: line.lineNo,
    itemId: line.itemId,
    itemLabel: itemCodeWithRev(line.itemCode, line.itemRevision),
    itemName: line.itemName,
    orderQty: line.orderQty,
    dispatchedQty: line.dispatchedQty,
    physicalQty: line.physicalQty,
    totalReservedQty: line.totalReservedQty,
    reservedQty: line.reservedQty,
    availableQty: line.availableQty,
  };
}

/** Pending = still owed to the customer on this line. */
export function pendingOf(f: StockLineFacts): number {
  return Math.max(0, f.orderQty - f.dispatchedQty);
}

/** The Allocate cap: never more free stock than exists, never more than the
 *  line still needs after what has shipped and what is already booked to it. */
export function allocateCap(f: StockLineFacts): number {
  return Math.max(0, Math.min(f.availableQty, f.orderQty - f.dispatchedQty - f.reservedQty));
}

const tile: React.CSSProperties = {
  textAlign: 'center',
  padding: '6px 14px',
  background: 'var(--bg)',
  borderRadius: 6,
  border: '1px solid var(--border)',
  minWidth: 88,
};

function NumberTile({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: number;
  color?: string;
  title?: string;
}): JSX.Element {
  return (
    <div style={tile} title={title}>
      <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</div>
      <div
        className="mono fw-700"
        style={{ fontSize: 18, color: color ?? 'var(--text)', whiteSpace: 'nowrap' }}
      >
        {value}
      </div>
    </div>
  );
}

/** The identity block both boxes share: Item, SO, Line. */
function LineIdentity({ f }: { f: StockLineFacts }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Item</div>
        {/* The item code is the main thing: strong mono, darkest text. */}
        <b className="mono" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
          {f.itemLabel}
        </b>
        {f.itemName ? (
          <span className="text2" style={{ fontSize: 12, marginLeft: 6 }}>
            {f.itemName}
          </span>
        ) : null}
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>SO</div>
        <b className="mono" style={{ whiteSpace: 'nowrap' }}>
          {f.soCode}
        </b>
      </div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Ln</div>
        <b className="mono">{f.lineNo}</b>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }): JSX.Element {
  return (
    <div
      className="empty-state"
      style={{
        marginTop: 12,
        padding: 8,
        borderRadius: 4,
        background: 'var(--red3)',
        color: 'var(--red2)',
      }}
    >
      {message}
    </div>
  );
}

// ─── Allocate ─────────────────────────────────────────────────────────────

export function AllocateStockModal({
  facts,
  onClose,
  onDone,
}: {
  facts: StockLineFacts;
  onClose: () => void;
  /** Called with the post-action Physical / Reserved / Available. */
  onDone: (result: ReservationActionResult) => void;
}): JSX.Element {
  // The planning sheet refreshes on a 60s timer, so its stock numbers can be a
  // minute old. Re-read the live three for this item while the box is open —
  // the cap has to be right at the moment someone presses Allocate.
  const live = useStockAvailability(facts.itemId);
  const shown: StockLineFacts = live.data
    ? {
        ...facts,
        physicalQty: live.data.physicalQty,
        totalReservedQty: live.data.reservedQty,
        availableQty: live.data.availableQty,
      }
    : facts;
  const cap = allocateCap(shown);
  const [qty, setQty] = useState<string>('');
  // Until the user types, the field simply mirrors the cap — so a cap that
  // moves when the live numbers land does not leave a stale default behind.
  const [touched, setTouched] = useState(false);
  const shownQty = touched ? qty : cap > 0 ? String(cap) : '';
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reserve = useReserveStock();

  const typed = shownQty.trim() === '' ? 0 : Number(shownQty);
  const valid = Number.isFinite(typed) && Number.isInteger(typed) && typed > 0 && typed <= cap;

  const submit = async (): Promise<void> => {
    if (!facts.itemId) {
      setErr('This line has no stock-tracked item to allocate.');
      return;
    }
    if (!Number.isFinite(typed) || !Number.isInteger(typed) || typed <= 0) {
      setErr('Enter a whole quantity greater than 0.');
      return;
    }
    if (typed > cap) {
      setErr(`Cannot allocate more than ${cap} — that is all this line can take.`);
      return;
    }
    setErr(null);
    try {
      const result = await reserve.mutateAsync({
        soLineId: facts.soLineId,
        itemId: facts.itemId,
        qty: typed,
        soCodeText: facts.soCode,
        lineNo: facts.lineNo,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      onDone(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reserve stock. Try again.');
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void submit()}
        disabled={reserve.isPending || !valid || !facts.itemId}
        title={
          !facts.itemId
            ? 'This line has no stock-tracked item'
            : cap <= 0
              ? 'Nothing can be allocated to this line right now'
              : `Reserve ${valid ? typed : 0} pcs to ${facts.soCode} line ${facts.lineNo}`
        }
      >
        {reserve.isPending ? 'Allocating…' : 'Allocate'}
      </button>
    </>
  );

  return (
    <Modal title={`Allocate Stock — ${facts.itemLabel}`} onClose={onClose} footer={footer}>
      <LineIdentity f={shown} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <NumberTile
          label="Available"
          value={shown.availableQty}
          color={shown.availableQty > 0 ? 'var(--green)' : 'var(--text3)'}
        />
        <NumberTile
          label="Reserved (This Line)"
          value={shown.reservedQty}
          color={shown.reservedQty > 0 ? 'var(--purple)' : 'var(--text3)'}
        />
      </div>

      <div className="form-grp" style={{ marginBottom: 12 }}>
        <label
          className="form-label"
          htmlFor="allocate-qty"
          style={{ color: 'var(--amber2)', fontWeight: 700 }}
        >
          Qty to allocate ★
        </label>
        <input
          id="allocate-qty"
          type="number"
          className="innovic-input"
          min={1}
          max={cap}
          step={1}
          value={shownQty}
          disabled={cap <= 0}
          onChange={(e) => {
            setTouched(true);
            setQty(e.target.value);
          }}
          style={{ width: 160, fontSize: 16, fontWeight: 700 }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          {cap > 0
            ? `Max ${cap}.`
            : shown.availableQty <= 0
              ? 'No free stock to allocate — Available is 0.'
              : 'This line is already covered by what has been dispatched and reserved to it.'}
        </div>
      </div>

      <div className="form-grp">
        <label className="form-label" htmlFor="allocate-remarks">
          Remarks (optional)
        </label>
        <input
          id="allocate-remarks"
          className="innovic-input"
          maxLength={500}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Why this stock is being booked…"
        />
      </div>

      {err ? <ErrorBox message={err} /> : null}
    </Modal>
  );
}

// ─── Release ──────────────────────────────────────────────────────────────

export function ReleaseStockModal({
  facts,
  onClose,
  onDone,
}: {
  facts: StockLineFacts;
  onClose: () => void;
  onDone: (result: ReservationActionResult) => void;
}): JSX.Element {
  const max = facts.reservedQty;
  const [qty, setQty] = useState<string>(max > 0 ? String(max) : '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const release = useReleaseReservations();

  const typed = qty.trim() === '' ? 0 : Number(qty);
  const qtyOk = Number.isFinite(typed) && Number.isInteger(typed) && typed > 0 && typed <= max;
  const reasonOk = reason.trim().length > 0;

  const submit = async (): Promise<void> => {
    if (!qtyOk) {
      setErr(`Enter a whole quantity between 1 and ${max}.`);
      return;
    }
    if (!reasonOk) {
      setErr('A reason is required to release stock.');
      return;
    }
    setErr(null);
    try {
      const result = await release.mutateAsync({
        soLineId: facts.soLineId,
        qty: typed,
        reason: reason.trim(),
      });
      onDone(result);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not release the reserved stock. Try again.');
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn"
        style={{ background: 'var(--amber)', borderColor: 'var(--amber)', color: 'var(--bg)' }}
        onClick={() => void submit()}
        disabled={release.isPending || !qtyOk || !reasonOk}
        title={
          !reasonOk
            ? 'Type a reason first — releasing stock needs one'
            : `Release ${qtyOk ? typed : 0} pcs back to free stock`
        }
      >
        {release.isPending ? 'Releasing…' : 'Release'}
      </button>
    </>
  );

  return (
    <Modal title={`Release Reserved Stock — ${facts.itemLabel}`} onClose={onClose} footer={footer}>
      <LineIdentity f={facts} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <NumberTile label="Physical" value={facts.physicalQty} color="var(--cyan)" />
        <NumberTile
          label="Reserved (This Line)"
          value={facts.reservedQty}
          color={facts.reservedQty > 0 ? 'var(--purple)' : 'var(--text3)'}
        />
        <NumberTile
          label="Available"
          value={facts.availableQty}
          color={facts.availableQty > 0 ? 'var(--green)' : 'var(--text3)'}
        />
      </div>

      <div className="form-grp" style={{ marginBottom: 12 }}>
        <label
          className="form-label"
          htmlFor="release-qty"
          style={{ color: 'var(--amber2)', fontWeight: 700 }}
        >
          Qty to release ★
        </label>
        <input
          id="release-qty"
          type="number"
          className="innovic-input"
          min={1}
          max={max}
          step={1}
          value={qty}
          disabled={max <= 0}
          onChange={(e) => setQty(e.target.value)}
          style={{ width: 160, fontSize: 16, fontWeight: 700 }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          {max > 0 ? `Max ${max}.` : 'Nothing is reserved to this line.'}
        </div>
      </div>

      <div className="form-grp">
        <label
          className="form-label"
          htmlFor="release-reason"
          style={{ color: 'var(--amber2)', fontWeight: 700 }}
        >
          Reason ★
        </label>
        <textarea
          id="release-reason"
          className="innovic-input"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this stock being given back?"
        />
      </div>

      {err ? <ErrorBox message={err} /> : null}
    </Modal>
  );
}
