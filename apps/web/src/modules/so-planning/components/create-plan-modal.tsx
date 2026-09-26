// Create Plan box (ADR-170). Opened by "+ Plan N" on a line of the SO/JWSO
// Planning screen.
//
// A plan is now ONLY: qty + remark, a schedule (planned start / required
// date, planned end date) and the raw material (grade, size). No operations —
// those come from the item's Route Card when a Production Order is raised for
// this plan. So the box saves the plan with `opsSource: 'route_card'` and
// closes; it does NOT chain into the Edit Plan modal any more.
//
// The Reserve-from-stock control that lived here stays: it books free stock
// to this line before (or instead of) planning the shortfall.
//
// ESC / click outside ask "Are you sure you want to exit?" through `Modal`.

import type { CreatePlanInput, PlanningDetailResponse, PlanningLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { addDaysLocal, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { PLAN_DEFAULT_SPAN_DAYS } from '@/modules/plans/components/plan-form';
import { useCreatePlan, useDefaultRouteOps, useReserveStock } from '@/modules/plans/api';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { Modal } from './modal';
import { ReleaseStockModal, lineFacts } from './reservation-modals';

// −/+ stepper buttons: same .btn .btn-ghost shape as the ▲▼ movers elsewhere,
// just squared off so they sit flush against the qty box.
const stepBtnStyle: React.CSSProperties = {
  padding: '0 12px',
  fontSize: 18,
  lineHeight: 1,
  minWidth: 38,
  height: 38,
};

const groupTitle: React.CSSProperties = {
  fontSize: 11,
  marginBottom: 6,
};

interface Props {
  so: PlanningDetailResponse;
  line: PlanningLine;
  onClose: () => void;
  /** Called with the new plan id once it is saved. */
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
  const [remarks, setRemarks] = useState('');
  // Born dated: start today, finish five days later — the common case, and
  // both are right here to change before saving.
  const [plannedStartDate, setPlannedStartDate] = useState(todayLocal());
  const [plannedEndDate, setPlannedEndDate] = useState(
    addDaysLocal(todayLocal(), PLAN_DEFAULT_SPAN_DAYS),
  );
  // Customer Dispatch Date — the day the goods must leave for the customer.
  // Defaults from the SO/JWSO line's due date when it has one; optional.
  const [customerDispatchDate, setCustomerDispatchDate] = useState(
    line.dueDate ? line.dueDate.slice(0, 10) : '',
  );
  const [rmGradeId, setRmGradeId] = useState<string | null>(null);
  const [rmGradeText, setRmGradeText] = useState<string | null>(null);
  const [rmSizeId, setRmSizeId] = useState<string | null>(null);
  const [rmSizeText, setRmSizeText] = useState<string | null>(null);
  // Auto-fetch the raw material chosen on the item's route card (grade + size)
  // — the same rule the standalone Plan form applies (plan-form.tsx): only
  // while a field is still blank, so the planner's own pick is never
  // overwritten. User, 2026-09-22: "I already selected the raw material
  // during RC creation" — it must not have to be picked twice.
  const { data: defaultOps } = useDefaultRouteOps(line.itemId ?? null);
  useEffect(() => {
    if (!defaultOps) return;
    if (
      !rmGradeId &&
      !rmGradeText &&
      (defaultOps.rawMaterialGradeId || defaultOps.rawMaterialGradeText)
    ) {
      setRmGradeId(defaultOps.rawMaterialGradeId);
      setRmGradeText(defaultOps.rawMaterialGradeText);
    }
    if (
      !rmSizeId &&
      !rmSizeText &&
      (defaultOps.rawMaterialSizeId || defaultOps.rawMaterialSizeText)
    ) {
      setRmSizeId(defaultOps.rawMaterialSizeId);
      setRmSizeText(defaultOps.rawMaterialSizeText);
    }
    // Prefill is a one-shot per lookup result; the field states are read, not
    // dependencies, so a later manual clear is not refilled.
  }, [defaultOps]);
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
  // ADR-180: releasing a booking now needs a reason, so the old one-click
  // "release" link is a box of its own (shared with the Planning sheet).
  const [releaseOpen, setReleaseOpen] = useState(false);

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
      setErr(e instanceof Error ? e.message : 'Could not reserve stock. Try again.');
    }
  };

  const submit = async () => {
    if (planQty <= 0) {
      setErr('Qty must be greater than 0');
      return;
    }
    if (planQty > remaining) {
      setErr(`Plan Qty cannot be more than Pending to Plan (${remaining}).`);
      return;
    }
    if (!plannedStartDate || !plannedEndDate) {
      setErr('Planned Start and Planned End dates are required');
      return;
    }
    if (plannedEndDate < plannedStartDate) {
      setErr('Planned End Date cannot be before Planned Start Date');
      return;
    }
    setErr(null);
    const input: CreatePlanInput = {
      // code omitted → server assigns the next sequential PLN-NNNN.
      planDate: todayLocal(),
      planType: 'manufacture',
      // Operations come from the item's Route Card via a Production Order;
      // the server stores this plan as `planned` with zero ops of its own.
      opsSource: 'route_card',
      // A JW plan links via jwLineId; an SO plan via soLineId. line.soLineId
      // holds whichever line id the detail endpoint returned.
      ...(so.source === 'jw' ? { jwLineId: line.soLineId } : { soLineId: line.soLineId }),
      soCodeText: so.soCode,
      lineNo: line.lineNo,
      itemId: line.itemId ?? null,
      itemCodeText: line.itemCode ?? '',
      itemNameText: line.itemName ?? '',
      orderQty: line.orderQty,
      planQty,
      plannedStartDate,
      plannedEndDate,
      customerDispatchDate: customerDispatchDate || null,
      rawMaterialGradeId: rmGradeId,
      rawMaterialGradeText: rmGradeText,
      rawMaterialSizeId: rmSizeId,
      rawMaterialSizeText: rmSizeText,
      remarks: remarks.trim() === '' ? null : remarks.trim(),
    };
    try {
      const created = await createPlan.mutateAsync(input);
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Plan. Try again.');
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
        onClick={() => void submit()}
        disabled={createPlan.isPending}
      >
        {createPlan.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            Saving…
          </>
        ) : (
          'Save Plan'
        )}
      </button>
    </>
  );

  // `CODE/REV` — the customer's drawing revision from this SO line, so the
  // planner can see which drawing they are planning against. A JW line has no
  // customer revision, and then this is the bare code with no trailing slash.
  const lineLabel = line.itemCode
    ? itemCodeWithRev(line.itemCode, line.itemRevision)
    : (line.itemName ?? `Line ${line.lineNo}`);

  // ADR-180 — releasing needs a qty and a reason, so it has its own box, shared
  // with the Planning sheet. It SWAPS for this one rather than sitting inside
  // it: two Modal instances each register a window ESC listener and each
  // set/clear document.body.style.overflow, so ESC raised two "are you sure you
  // want to exit?" prompts at once and closing the inner box gave the page its
  // scrollbar back while the outer one was still open. This component stays
  // mounted either way, so a half-filled plan form is still there when the
  // release box closes.
  if (releaseOpen) {
    return (
      <ReleaseStockModal
        facts={lineFacts(so.soCode, line)}
        onClose={() => setReleaseOpen(false)}
        onDone={() => setReleaseOpen(false)}
      />
    );
  }

  return (
    <Modal title={`Create Plan — ${lineLabel}`} size="lg" onClose={onClose} footer={footer}>
      {/* ── What is being planned ── */}
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
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              {so.source === 'jw' ? 'JWSO' : 'SO'}
            </span>
            <br />
            <b className="mono">
              {so.soCode} Ln {line.lineNo}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>ITEM</span>
            <br />
            {/* Item code is the main thing: strong mono, darkest text. */}
            <b className="mono" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
              {itemCodeWithRev(line.itemCode, line.itemRevision)}
            </b>
            {line.itemName ? (
              <span className="text2" style={{ fontSize: 12, marginLeft: 6 }}>
                {line.itemName}
              </span>
            ) : null}
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Order Qty</span>
            <br />
            <b style={{ fontSize: 18 }}>{line.orderQty}</b>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Plan Qty</div>
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
              border: '1px solid var(--green)',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Pending to Plan</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--green2)' }}>
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
            {/* ADR-180 — this is AVAILABLE (physical − reserved), not what is
                on the shelf. PHYSICAL sits in its own tile beside it. */}
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Available</div>
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
            title="On the shelf for this item — reserving never changes it"
          >
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Physical</div>
            <div
              className="mono fw-700"
              style={{ fontSize: 20, color: line.physicalQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}
            >
              {line.physicalQty}
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
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Reserved</div>
            <div
              className="mono fw-700"
              style={{ fontSize: 20, color: reserved > 0 ? 'var(--purple)' : 'var(--text3)' }}
            >
              {reserved}
            </div>
            {reserved > 0 ? (
              <button
                type="button"
                onClick={() => setReleaseOpen(true)}
                title="Give this booking back to free stock — a reason is required"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  marginTop: 2,
                  color: 'var(--cyan)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                release
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Plan qty + Remark on one row ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div className="form-grp" style={{ flex: '0 1 200px', minWidth: 0 }}>
          <label
            className="form-label"
            htmlFor="create-plan-qty"
            style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 14 }}
          >
            Plan Qty ★
          </label>
          <input
            id="create-plan-qty"
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
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Max {remaining}</div>
        </div>
        <div className="form-grp" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <label className="form-label" htmlFor="create-plan-remark">
            Remarks
          </label>
          <textarea
            id="create-plan-remark"
            className="innovic-input"
            rows={3}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Planning notes, special instructions"
            style={{ width: '100%', resize: 'vertical' }}
          />
        </div>
      </div>

      {/* ── Schedule + Raw Material — same controls as Edit Plan ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          alignItems: 'flex-end',
          marginBottom: 14,
        }}
      >
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div className="mono fw-700 text3" style={groupTitle}>
            Schedule
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div className="form-grp" style={{ flex: '1 1 150px', minWidth: 0 }}>
              <label className="form-label" htmlFor="create-plan-start">
                Planned Start Date
              </label>
              <input
                id="create-plan-start"
                type="date"
                className="innovic-input"
                value={plannedStartDate}
                onChange={(e) => setPlannedStartDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ flex: '1 1 150px', minWidth: 0 }}>
              <label className="form-label" htmlFor="create-plan-end">
                Planned End Date
              </label>
              <input
                id="create-plan-end"
                type="date"
                className="innovic-input"
                value={plannedEndDate}
                onChange={(e) => setPlannedEndDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ flex: '1 1 150px', minWidth: 0 }}>
              <label className="form-label" htmlFor="create-plan-dispatch">
                Customer Dispatch Date
              </label>
              <input
                id="create-plan-dispatch"
                type="date"
                className="innovic-input"
                value={customerDispatchDate}
                onChange={(e) => setCustomerDispatchDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        {/* The tint IS the grouping: .field-tint paints every control inside
            this block with the pale blue token wash (--blue3), including the
            Grade / Size pickers' own <input>. */}
        <div className="field-tint" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div className="mono fw-700" style={{ ...groupTitle, color: 'var(--blue)' }}>
            Raw Material
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div className="form-grp" style={{ flex: '1 1 130px', minWidth: 0 }}>
              <label className="form-label" style={{ color: 'var(--blue)' }}>
                Grade
              </label>
              <MaterialGradePicker
                valueId={rmGradeId}
                valueText={rmGradeText}
                onChange={(id, text) => {
                  setRmGradeId(id);
                  setRmGradeText(text);
                }}
              />
            </div>
            <div className="form-grp" style={{ flex: '1 1 140px', minWidth: 0 }}>
              <label className="form-label" style={{ color: 'var(--blue)' }}>
                Size
              </label>
              <MaterialSizePicker
                valueId={rmSizeId}
                valueText={rmSizeText}
                onChange={(id, text) => {
                  setRmSizeId(id);
                  setRmSizeText(text);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reserve from stock — the qty is adjustable, and the Reserve button in
          the footer books exactly what's set here. Reserving again adds to the
          line (the max recomputes); "release" on the RESERVED tile gives the
          whole booking back. */}
      {line.itemId ? (
        <div className="form-grp" style={{ marginBottom: 4 }}>
          <label
            className="form-label"
            htmlFor="reserve-qty"
            style={{ color: 'var(--amber2)', fontWeight: 700, fontSize: 14 }}
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
                color: 'var(--amber2)',
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
              ? `Max ${reservable}`
              : stock <= 0
                ? 'No free stock to reserve — Available is 0.'
                : 'This line is already fully covered — nothing left to reserve.'}
            {reserved > 0
              ? ` · Already reserved: ${reserved} — use “release” above to give it back.`
              : ''}
          </div>
        </div>
      ) : null}

      {err ? (
        <div
          className="empty-state"
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'var(--red3)',
            color: 'var(--red2)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
