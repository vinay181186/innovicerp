// Create Plan modal (PL-4b §4). Triggered by "+ Plan N pcs" on a line card.
// Shows a single qty input; on save creates an in_planning plan and chains
// to the edit modal so the planner can fill in operations + type details.

import type {
  CreatePlanInput,
  PlanningDetailResponse,
  PlanningLine,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { todayLocal } from '@/lib/date';
import { useCreatePlan, useReleaseReservations, useReserveStock } from '@/modules/plans/api';
import { Modal } from './modal';

// −/+ stepper buttons: same .btn .btn-ghost shape as the ▲▼ movers elsewhere,
// just squared off so they sit flush against the qty box.
const stepBtnStyle: React.CSSProperties = {
  padding: '0 12px',
  fontSize: 18,
  lineHeight: 1,
  minWidth: 38,
  height: 38,
};

interface Props {
  so: PlanningDetailResponse;
  line: PlanningLine;
  onClose: () => void;
  /** Called with the new plan id so the parent can chain into the edit modal. */
  onCreated: (planId: string) => void;
}

export function CreatePlanModal({ so, line, onClose, onCreated }: Props): JSX.Element {
  const remaining = line.remaining;
  const stock = line.stockQty;
  const reserved = line.reservedQty;
  // What still needs to be MADE after counting what's already in stock.
  const suggested = Math.max(0, remaining - stock);
  // Reservable = free stock, capped by the order qty still uncovered by
  // plans/direct JCs/existing reservations.
  const uncovered = Math.max(0, remaining - reserved);
  const reservable = Math.min(stock, uncovered);
  const [planQty, setPlanQty] = useState<number>(suggested);
  // Reserve qty is adjustable — it starts at everything that's free to book,
  // but the planner can dial it down (or back up) before pressing Reserve.
  // Clamped on render instead of via an effect: after a reserve succeeds the
  // line refetches, `reservable` shrinks, and the typed value follows it down.
  const [reserveQty, setReserveQty] = useState<number>(reservable);
  const qtyToReserve = Math.min(Math.max(Math.trunc(reserveQty) || 0, 0), reservable);
  const canReserve = Boolean(line.itemId) && reservable > 0 && qtyToReserve > 0;
  const [err, setErr] = useState<string | null>(null);
  const createPlan = useCreatePlan();
  const reserve = useReserveStock();
  const release = useReleaseReservations();

  const doReserve = async () => {
    if (!line.itemId) {
      setErr('This line has no stock-tracked item to reserve.');
      return;
    }
    if (reservable <= 0) {
      setErr('Nothing available to reserve.');
      return;
    }
    if (qtyToReserve <= 0) {
      setErr('Reserve qty must be greater than 0.');
      return;
    }
    setErr(null);
    try {
      await reserve.mutateAsync({
        soLineId: line.soLineId,
        itemId: line.itemId,
        qty: qtyToReserve,
        soCodeText: so.soCode,
        lineNo: line.lineNo,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to reserve');
    }
  };

  const doRelease = async () => {
    setErr(null);
    try {
      await release.mutateAsync({ soLineId: line.soLineId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to release');
    }
  };

  const submit = async () => {
    if (planQty <= 0) {
      setErr('Qty must be greater than 0');
      return;
    }
    if (planQty > remaining) {
      setErr(`Cannot exceed remaining: ${remaining} pcs`);
      return;
    }
    setErr(null);
    const input: CreatePlanInput = {
      // code omitted → server assigns the next sequential PLN-NNNN.
      planDate: todayLocal(),
      planType: 'manufacture',
      // A JW plan links via jwLineId; an SO plan via soLineId. line.soLineId
      // holds whichever line id the detail endpoint returned.
      ...(so.source === 'jw'
        ? { jwLineId: line.soLineId }
        : { soLineId: line.soLineId }),
      soCodeText: so.soCode,
      lineNo: line.lineNo,
      itemId: line.itemId ?? null,
      itemCodeText: line.itemCode ?? '',
      itemNameText: line.itemName ?? '',
      orderQty: line.orderQty,
      planQty,
    };
    try {
      const created = await createPlan.mutateAsync(input);
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create plan');
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
        onClick={() => void doReserve()}
        disabled={reserve.isPending || !canReserve}
        title={
          !line.itemId
            ? 'This line has no stock-tracked item'
            : reservable <= 0
              ? 'Nothing available to reserve'
              : `Reserve ${qtyToReserve} pcs from stock to ${so.soCode}`
        }
      >
        {reserve.isPending ? 'Reserving…' : `Reserve ${qtyToReserve}`}
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
        disabled={createPlan.isPending}
      >
        {createPlan.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} /> …
          </>
        ) : (
          // Legacy createPlan calls showModal(title, body, onSave, 'Create Plan'),
          // but showModal (L28014) takes only 3 params — the 4th arg is dead code
          // and the footer is the hard-coded Cancel / Save pair (L28026-27).
          'Save'
        )}
      </button>
    </>
  );

  return (
    <Modal
      title={`Create Plan — ${line.itemCode ?? line.itemName ?? `Line ${line.lineNo}`}`}
      onClose={onClose}
      footer={footer}
    >
      <div
        style={{
          background: 'var(--bg3)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO/JW</span>
            <br />
            <b className="mono">
              {so.soCode} L{line.lineNo}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>ITEM</span>
            <br />
            <b style={{ color: 'var(--purple)' }}>{line.itemCode ?? '—'}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO QTY</span>
            <br />
            <b style={{ fontSize: 18 }}>{line.orderQty}</b>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>ALREADY PLANNED</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--cyan)' }}>
              {line.totalPlanned}
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid rgba(34,197,94,0.3)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>REMAINING</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--green)' }}>
              {remaining}
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>IN STOCK</div>
            <div
              className="mono fw-700"
              style={{ fontSize: 20, color: stock > 0 ? 'var(--amber)' : 'var(--text3)' }}
            >
              {stock}
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>RESERVED</div>
            <div
              className="mono fw-700"
              style={{ fontSize: 20, color: reserved > 0 ? 'var(--purple)' : 'var(--text3)' }}
            >
              {reserved}
            </div>
            {reserved > 0 ? (
              <button
                type="button"
                onClick={() => void doRelease()}
                disabled={release.isPending}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginTop: 2,
                  color: 'var(--cyan)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {release.isPending ? '…' : 'release'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Reserve from stock — the qty is adjustable, and the Reserve button in
          the footer books exactly what's set here. Reserving again adds to the
          line (the max recomputes); "release" on the RESERVED tile gives the
          whole booking back. */}
      {line.itemId ? (
        <div className="form-grp" style={{ marginBottom: 14 }}>
          <label
            className="form-label"
            htmlFor="reserve-qty"
            style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 14 }}
          >
            Reserve Qty (from stock)
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={stepBtnStyle}
              onClick={() => setReserveQty(Math.max(0, qtyToReserve - 1))}
              disabled={qtyToReserve <= 0}
              aria-label="Decrease reserve qty"
              title="Decrease by 1"
            >
              −
            </button>
            <input
              id="reserve-qty"
              type="number"
              min={0}
              max={reservable}
              step={1}
              value={qtyToReserve}
              onChange={(e) => setReserveQty(Number(e.target.value))}
              disabled={reservable <= 0}
              style={{
                fontSize: 18,
                fontWeight: 800,
                textAlign: 'center',
                border: '2px solid var(--amber)',
                color: 'var(--amber)',
                padding: 6,
                width: 120,
                height: 38,
              }}
            />
            <button
              type="button"
              className="btn btn-ghost"
              style={stepBtnStyle}
              onClick={() => setReserveQty(Math.min(reservable, qtyToReserve + 1))}
              disabled={qtyToReserve >= reservable}
              aria-label="Increase reserve qty"
              title="Increase by 1"
            >
              +
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setReserveQty(reservable)}
              disabled={reservable <= 0 || qtyToReserve === reservable}
              title={`Set to the full ${reservable} pcs free to reserve`}
            >
              Max
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            {reservable > 0
              ? `Max: ${reservable} pcs (In Stock: ${stock}, still uncovered: ${uncovered})`
              : stock <= 0
                ? 'Nothing in stock to reserve.'
                : 'This line is already fully covered — nothing left to reserve.'}
            {reserved > 0 ? ` · Already reserved: ${reserved} — use “release” above to give it back.` : ''}
          </div>
        </div>
      ) : null}

      <div className="form-grp">
        <label
          className="form-label"
          style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 14 }}
        >
          Plan Qty ★
        </label>
        <input
          type="number"
          min={1}
          max={remaining}
          value={planQty}
          onChange={(e) => setPlanQty(Number(e.target.value))}
          style={{
            fontSize: 22,
            fontWeight: 800,
            textAlign: 'center',
            border: '2px solid var(--cyan)',
            color: 'var(--cyan)',
            padding: 10,
            width: '100%',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          Max: {remaining} pcs (SO: {line.orderQty} − Already Planned: {line.totalPlanned})
        </div>
        {stock > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
            💡 {suggested} pcs to make — {remaining} remaining − {stock} already in stock
            {suggested === 0 ? ' (fully covered by stock)' : ''}.
          </div>
        ) : null}
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
