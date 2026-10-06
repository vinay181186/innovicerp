// Create Plan box (ADR-170). Opened by "+ Plan N" on a line of the SO/JWSO
// Planning screen.
//
// A plan is now ONLY: qty + remark and a schedule (planned start / required
// date, planned end date). No operations — those come from the item's Route
// Card when a Production Order is raised for this plan. So the box saves the
// plan with `opsSource: 'route_card'` and closes; it does NOT chain into the
// Edit Plan modal any more.
//
// ADR-218: RM Grade / RM Size are SHOWN here and nothing more — their one
// author is the part's Route Card (or the BOM line for a BOM child), and this
// box leaves both out of the payload so the server fills them from there.
//
// The Reserve-from-stock control that lived here stays: it books free stock
// to this line before (or instead of) planning the shortfall.
//
// ESC / click outside ask "Are you sure you want to exit?" through `Modal`.

import type {
  CreatePlanInput,
  PlanDetail,
  PlanningDetailResponse,
  PlanningLine,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { addDaysLocal, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { PLAN_DEFAULT_SPAN_DAYS } from '@/modules/plans/components/plan-form';
import { useCreatePlan, useDefaultRouteOps, useReserveStock } from '@/modules/plans/api';
import {
  MaterialValueDisplay,
  RM_SOURCE_HELP,
} from '@/modules/raw-material/components/raw-material-pickers';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentCode,
  IdentSep,
} from '@/ui/forms';
import { Modal } from './modal';
import { ReleaseStockModal, lineFacts } from './reservation-modals';

interface Props {
  so: PlanningDetailResponse;
  line: PlanningLine;
  onClose: () => void;
  /** Called with the saved plan, so the page can offer the next step
   *  (Create Production Order →, or make the Route Card first). */
  onCreated: (plan: PlanDetail) => void;
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
  // ADR-218 — raw material is READ here, never set. The item's Route Card is
  // what the server will copy onto this plan, so the same lookup that served
  // the old prefill now just supplies the two values SHOWN below.
  const { data: defaultOps } = useDefaultRouteOps(line.itemId ?? null);
  // Reserve qty is adjustable — it starts at everything that's free to book,
  // but the planner can dial it down (or back up) before pressing Reserve.
  // Clamped on render instead of via an effect: after a reserve succeeds the
  // line refetches, `reservable` shrinks, and the typed value follows it down.
  const [reserveQty, setReserveQty] = useState<number>(reservable);
  const qtyToReserve = Math.min(Math.max(Math.trunc(reserveQty) || 0, 0), reservable);
  const canReserve = Boolean(line.itemId) && reservable > 0 && qtyToReserve > 0;
  const [err, setErr] = useState<string | null>(null);
  const saveKey = useSaveKey();
  const createPlan = useCreatePlan(saveKey);
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
    // ADR-218 — RM Grade / RM Size are NEVER sent from here. They have one
    // author: the part's Route Card, or the BOM line for a BOM child. Server
    // contract (apps/api/src/modules/plans/service.ts, createPlan): a field
    // that IS sent — a value OR an explicit null — means "the caller owns this
    // pair, do not default it", and only an OMITTED pair is filled from the
    // BOM line / Route Card. So both pairs are OMITTED, never sent as null.
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
      remarks: remarks.trim() === '' ? null : remarks.trim(),
    };
    try {
      const created = await createPlan.mutateAsync(input);
      onCreated(created);
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
              : `Reserve ${qtyToReserve} pcs from stock to ${soNoWithInternal(so.soCode, so.soInternalNo)}`
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
        facts={lineFacts(so.soCode, line, so.soInternalNo)}
        onClose={() => setReleaseOpen(false)}
        onDone={() => setReleaseOpen(false)}
      />
    );
  }

  return (
    <Modal title={`Create Plan — ${lineLabel}`} size="lg" onClose={onClose} footer={footer}>
      {/* ── WHICH line is being planned. Identity only — no facts here. ── */}
      <DocIdent>
        <span>
          {so.source === 'jw' ? 'JWSO' : 'SO'}{' '}
          <IdentCode>{soNoWithInternal(so.soCode, so.soInternalNo)}</IdentCode>
        </span>
        <IdentSep />
        <span>Ln {line.lineNo}</span>
        <IdentSep />
        {/* Item code is the main thing: strong mono, darkest text. */}
        <IdentCode>{itemCodeWithRev(line.itemCode, line.itemRevision)}</IdentCode>
        {line.itemName ? <span>{line.itemName}</span> : null}
      </DocIdent>

      {/* ── The qty account, left to right, ending on its result: the order
             qty, less what plans and plan-less Job Cards already cover, is
             what is STILL TO PLAN (the green rule). ── */}
      <ClusterGrid>
        <Cluster>
          <ClusterFact label="Order Qty" value={line.orderQty} num />
          <ClusterFact label="Already Planned" value={line.totalPlanned} num />
          <ClusterFact
            label="JC Qty"
            value={line.directJcQty}
            num
            title={
              line.directJcCodes.length > 0
                ? `On Job Cards raised straight off this line, with no plan behind them: ${line.directJcCodes.join(', ')}`
                : 'Job Cards raised straight off this line, with no plan behind them'
            }
          />
          <ClusterFact label="To Plan" value={remaining} num lead />
        </Cluster>
      </ClusterGrid>

      <div className="divider" />

      {/* ── The eight fields, four to a row on the 12-column grid. ── */}
      <div className="form-grid-12">
        <FormField
          label="Plan Qty"
          required
          size="sm"
          htmlFor="create-plan-qty"
          help={`of ${remaining} to plan`}
        >
          <input
            id="create-plan-qty"
            type="number"
            className="innovic-input cl-num"
            min={1}
            max={remaining}
            value={planQty}
            onChange={(e) => setPlanQty(Number(e.target.value))}
          />
        </FormField>

        {/* Reserve from stock — the typed qty IS the booking; the Reserve
            button in the footer books exactly what is set here. Reserving
            again adds to the line (the max recomputes); "release" gives a
            booking back and needs a reason (ADR-180). */}
        {line.itemId ? (
          <FormField
            label="Reserve Qty"
            size="sm"
            htmlFor="reserve-qty"
            help={
              <>
                {reservable > 0
                  ? `Max ${reservable} · ${stock} available · ${line.physicalQty} on shelf`
                  : stock <= 0
                    ? `No free stock to reserve — Available is 0 · ${line.physicalQty} on shelf`
                    : `This line is already fully covered — nothing left to reserve · ${line.physicalQty} on shelf`}
                {reserved > 0 ? (
                  <>
                    {` · ${reserved} reserved `}
                    <button
                      type="button"
                      onClick={() => setReleaseOpen(true)}
                      title="Give this booking back to free stock — a reason is required"
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: 'var(--cyan)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      release
                    </button>
                  </>
                ) : null}
              </>
            }
          >
            <input
              id="reserve-qty"
              type="number"
              className="innovic-input cl-num"
              min={0}
              max={reservable}
              step={1}
              value={qtyToReserve}
              onChange={(e) => setReserveQty(Number(e.target.value))}
              disabled={reservable <= 0}
            />
          </FormField>
        ) : (
          // No stock-tracked item on this line, so there is nothing to book —
          // the cell still stands so the row keeps its four columns.
          <FormField label="Reserve Qty" size="sm" help="This line has no stock-tracked item.">
            <input className="innovic-input cl-num" value="" readOnly disabled tabIndex={-1} />
          </FormField>
        )}

        <FormField label="Planned Start Date" required size="sm" htmlFor="create-plan-start">
          <input
            id="create-plan-start"
            type="date"
            className="innovic-input"
            value={plannedStartDate}
            onChange={(e) => setPlannedStartDate(e.target.value)}
          />
        </FormField>

        <FormField label="Planned End Date" required size="sm" htmlFor="create-plan-end">
          <input
            id="create-plan-end"
            type="date"
            className="innovic-input"
            value={plannedEndDate}
            onChange={(e) => setPlannedEndDate(e.target.value)}
          />
        </FormField>

        <FormField label="Customer Dispatch Date" size="sm" htmlFor="create-plan-dispatch">
          <input
            id="create-plan-dispatch"
            type="date"
            className="innovic-input"
            value={customerDispatchDate}
            onChange={(e) => setCustomerDispatchDate(e.target.value)}
          />
        </FormField>

        {/* ADR-218 — shown, not picked: these are the values the new plan will
            be given. The pale blue grouping wash (.field-tint) is gone with the
            pickers — it would have painted over the grey "not editable" fill
            and the boxes would still have read as something to type in. */}
        <FormField label="RM Grade" size="sm" help={RM_SOURCE_HELP}>
          <MaterialValueDisplay value={defaultOps?.rawMaterialGradeText} />
        </FormField>

        <FormField label="RM Size" size="sm">
          <MaterialValueDisplay value={defaultOps?.rawMaterialSizeText} />
        </FormField>

        <FormField label="Remarks" size="sm" htmlFor="create-plan-remark">
          <textarea
            id="create-plan-remark"
            className="innovic-input"
            rows={2}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </FormField>
      </div>

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
