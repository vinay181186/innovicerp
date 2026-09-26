// Create Production Order (ADR-170, ADR-182): Plan + Route Card + Order Qty +
// Customer Dispatch Date (labelled so on screen; the wire field stays
// `targetDate`) → Create JC.
//
// ADR-182 added three things to this screen:
//   • Order Qty — a plan may be covered by SEVERAL orders now (50 = 20+20+10),
//     so the screen asks how many pieces THIS order is for. It defaults to the
//     plan's `Pending` (NAMING.md — never "Remaining"/"Balance") and is capped
//     there; the server re-checks the cap under the plan's row lock.
//   • Raw material available — the shop floor confirms the material is on hand
//     BEFORE the order is raised. Unticked, Create is off and the screen says
//     exactly what the server would: "No raw material — you cannot create the
//     production order."
//   • Actual Size — the size really cut, beside the plan's master-picked size.
//     Carried onto the Job Card so the traveller prints what was actually used.
//
// The plan picker lists route-card-driven plans that still have Pending qty.
// The Route Card is the ONLY source of operations — "no route card,
// no way forward" — so with none for the item the Create JC button stays off
// and the screen says where to make one. The PO No is a read-only preview of
// the next number; the server assigns the real one.
//
// Gate + exit guard follow tpi-masters/routes/new.tsx. No Close button here on
// purpose: closing is its own screen (Production → Entry → Close Production
// Order) and its own permission (edit).

import type { CreateProductionOrderInput, PlanType, RouteCardListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { useRouteCardsList } from '@/modules/route-cards/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  type PlanPickerItem,
  planPickerLabel,
  useCreateProductionOrder,
  useNextProductionOrderCode,
  usePreselectedPlan,
} from '../api';
import { PlanPicker } from '../components/plan-picker';

// ?planId=&planCode= open the form with that plan already picked — the Plans
// list's "+ Create Production Order" button arrives this way. Both optional.
const newSearchSchema = z.object({
  planId: z.string().uuid().optional(),
  planCode: z.string().optional(),
});

export const productionOrderNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/new',
  validateSearch: (search) => newSearchSchema.parse(search),
  component: ProductionOrderNewPage,
});

function ProductionOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = productionOrderNewRoute.useSearch();
  const preselected = usePreselectedPlan(search.planId, search.planCode, 'create');
  const create = useCreateProductionOrder();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/production-orders' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Tier-driven, per department (Production). Entry raises a PO; the gate stops
  // the form appearing when the URL is typed directly by a viewer.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  const nextCode = useNextProductionOrderCode(perms.entry);

  const [plan, setPlan] = useState<PlanPickerItem | null>(null);
  const [routeCardId, setRouteCardId] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState('');
  const [remarks, setRemarks] = useState('');
  // ADR-182. Held as text so the field can be cleared while typing; parsed once
  // below. Defaults to the picked plan's Pending.
  const [orderQtyText, setOrderQtyText] = useState('');
  // Unticked on purpose: a confirmation that starts ticked confirms nothing.
  const [rawMaterialAvailable, setRawMaterialAvailable] = useState(false);
  const [actualSize, setActualSize] = useState('');

  // Route cards for the chosen plan's item only. One per item is the rule, so
  // the usual answer is exactly one row — preselected below.
  const planItemId = plan?.itemId ?? null;
  const routeCards = useRouteCardsList(
    { ...(planItemId ? { itemId: planItemId } : {}), limit: 50, offset: 0 },
    { enabled: Boolean(planItemId) },
  );
  const rcItems: RouteCardListItem[] = useMemo(
    () => (planItemId ? (routeCards.data?.items ?? []) : []),
    [planItemId, routeCards.data],
  );
  const rcLoaded = Boolean(planItemId) && routeCards.isSuccess;
  const noRouteCard = rcLoaded && rcItems.length === 0;

  // One route card per item is the rule, so the usual answer is exactly one
  // row — preselect it rather than make the user pick the only option.
  useEffect(() => {
    if (rcItems.length === 1) setRouteCardId(rcItems[0]?.id ?? null);
  }, [rcItems]);

  const onPickPlan = (p: PlanPickerItem | null): void => {
    setPlan(p);
    setRouteCardId(null);
    // Customer Dispatch Date on the plan is the PO's date; an older plan
    // without one falls back to its Planned End, as before.
    setTargetDate(p?.customerDispatchDate ?? p?.plannedEndDate ?? '');
    // ADR-182 — the usual answer is "all that is left", so Order Qty starts at
    // the plan's Pending and the user only types when ordering less.
    setOrderQtyText(p ? String(p.pendingQty) : '');
    setSubmitError(null);
  };
  // The deep-linked plan lands once its row arrives; only while nothing has
  // been picked yet, so a plan the user then changes by hand is left alone.
  useEffect(() => {
    if (preselected && !plan) onPickPlan(preselected);
    // onPickPlan is a plain setter bundle; the row is the trigger.
  }, [preselected]);

  const routeCard = rcItems.find((rc) => rc.id === routeCardId) ?? null;
  // The plan type lives on the ROUTE CARD. A direct-purchase item is bought,
  // not produced, so its card can never raise a Production Order (the API
  // refuses it too) — Create JC stays off with the reason shown.
  const directPurchase = routeCard?.planType === 'direct_purchase';

  // ADR-182 — Order Qty. Pending is the ceiling the server enforces under the
  // plan's row lock; the field simply refuses to ask for more.
  const pendingQty = plan?.pendingQty ?? 0;
  const orderQty = Number.parseInt(orderQtyText, 10);
  const orderQtyValid = Number.isInteger(orderQty) && orderQty > 0 && orderQty <= pendingQty;
  const orderQtyError = !plan
    ? null
    : pendingQty === 0
      ? `Plan ${plan.code} is fully covered by its Production Orders (${plan.planQty} of ${plan.planQty}).`
      : orderQtyText.trim() === ''
        ? 'Type how many pieces this order is for.'
        : !orderQtyValid
          ? `Order Qty must be between 1 and ${pendingQty} — that is all this plan has Pending.`
          : null;
  // The server's exact words, said here first so the user never meets it as an
  // error after a click (production-orders/service.ts).
  const NO_RAW_MATERIAL = 'No raw material — you cannot create the production order.';

  const canSubmit =
    Boolean(plan) &&
    Boolean(routeCardId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
    orderQtyValid &&
    rawMaterialAvailable &&
    !noRouteCard &&
    !directPurchase;

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!plan || !routeCardId || !canSubmit) return;
    setSubmitError(null);
    const input: CreateProductionOrderInput = {
      planId: plan.id,
      routeCardId,
      targetDate,
      orderQty,
      rawMaterialAvailable,
      actualSize: actualSize.trim() ? actualSize.trim() : null,
      remarks: remarks.trim() ? remarks.trim() : null,
    };
    try {
      const created = await create.mutateAsync(input);
      exit.leave(() => void navigate({ to: '/production-orders/$id', params: { id: created.id } }));
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not save Production Order. Try again.',
      );
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Production Orders…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Production Orders
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have create access to Production Orders. Ask an admin for L2 Data Entry or
            above in Production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link to="/production-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Production Orders
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">🏭 Create Production Order</div>
          </div>
          <div className="td-code" style={{ fontSize: 14, color: 'var(--text)' }}>
            {nextCode.data?.code ?? (nextCode.isLoading ? '…' : 'IN-PRO-?????')}
          </div>
        </div>
        <div className="panel-body">
          <form onSubmit={(e) => void onSubmit(e)}>
            <div className="form-grid form-grid-3">
              <div className="form-grp">
                <label className="form-label" htmlFor="po-code">
                  Production Order No
                </label>
                <input
                  id="po-code"
                  className="innovic-input mono fw-700"
                  value={nextCode.data?.code ?? ''}
                  readOnly
                  placeholder="assigned on save"
                />
              </div>

              <div className="form-span-2">
                <PlanPicker
                  id="po-plan"
                  mode="create"
                  value={plan?.id ?? null}
                  onChange={onPickPlan}
                  fallbackLabel={plan ? planPickerLabel(plan, 'create') : undefined}
                />
              </div>

              {plan ? (
                <div className="form-full">
                  <PlanSummary plan={plan} />
                </div>
              ) : null}

              <div className="form-grp form-span-2">
                <label className="form-label" htmlFor="po-route-card">
                  Route Card<span className="req">★</span>
                </label>
                <select
                  id="po-route-card"
                  className="innovic-select"
                  value={routeCardId ?? ''}
                  disabled={!plan || noRouteCard || routeCards.isLoading}
                  onChange={(e) => setRouteCardId(e.target.value || null)}
                >
                  <option value="">
                    {!plan
                      ? 'Pick a plan first'
                      : routeCards.isLoading
                        ? 'Loading route cards…'
                        : noRouteCard
                          ? 'No route card for this item'
                          : 'Select route card…'}
                  </option>
                  {rcItems.map((rc) => (
                    <option key={rc.id} value={rc.id}>
                      {rc.code} — Route Card Rev {rc.currentRevision} — {rc.opCount} op
                      {rc.opCount === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
                {routeCard ? (
                  <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                    <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {routeCard.code}
                    </span>{' '}
                    · Route Card Rev {routeCard.currentRevision} · {routeCard.opCount} operation
                    {routeCard.opCount === 1 ? '' : 's'}{' '}
                    <PlanTypeChip planType={routeCard.planType} />
                    {routeCard.opCount === 0 ? (
                      <span style={{ color: 'var(--amber2)' }}>
                        {' '}
                        — this route card has no operations; add them before creating the JC.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* ADR-182 — Order Qty. Defaults to the plan's Pending and is
                  capped there; the server re-checks under the plan's row lock,
                  so two people ordering at once cannot both fit. */}
              <div className="form-grp">
                <label className="form-label" htmlFor="po-order-qty">
                  Order Qty<span className="req">★</span>
                </label>
                <input
                  id="po-order-qty"
                  type="number"
                  className="innovic-input mono fw-700"
                  value={orderQtyText}
                  min={1}
                  max={pendingQty || undefined}
                  step={1}
                  disabled={!plan || pendingQty === 0}
                  onChange={(e) => setOrderQtyText(e.target.value)}
                  placeholder={plan ? String(pendingQty) : 'Pick a plan first'}
                />
                {plan ? (
                  <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                    Plan Qty {plan.planQty} · Covered {plan.coveredQty} · Pending{' '}
                    <span className="fw-700" style={{ color: 'var(--cyan)' }}>
                      {plan.pendingQty}
                    </span>
                  </div>
                ) : null}
                {orderQtyError ? <div className="form-error">{orderQtyError}</div> : null}
              </div>

              <div className="form-grp">
                <label className="form-label" htmlFor="po-target-date">
                  Customer Dispatch Date<span className="req">★</span>
                </label>
                <input
                  id="po-target-date"
                  type="date"
                  className="innovic-input"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  required
                />
              </div>

              {/* ADR-182 — the shop floor's confirmation that the material is
                  on hand. The server refuses a false value in these exact
                  words, so the screen says them first. */}
              <div className="form-grp">
                <span className="form-label">
                  Raw material available<span className="req">★</span>
                </span>
                <label
                  htmlFor="po-rm-available"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    id="po-rm-available"
                    type="checkbox"
                    checked={rawMaterialAvailable}
                    onChange={(e) => setRawMaterialAvailable(e.target.checked)}
                  />
                  The material for this order is in the store
                </label>
              </div>

              {/* ADR-182 — what the store really had / really cut, beside the
                  plan's master-picked Raw Material Size. Optional free text. */}
              <div className="form-grp">
                <label className="form-label" htmlFor="po-actual-size">
                  Actual Size
                </label>
                <input
                  id="po-actual-size"
                  className="innovic-input"
                  value={actualSize}
                  maxLength={120}
                  onChange={(e) => setActualSize(e.target.value)}
                  placeholder="size actually cut"
                />
              </div>

              <div className="form-grp form-full">
                <label className="form-label" htmlFor="po-remarks">
                  Remarks
                </label>
                <input
                  id="po-remarks"
                  className="innovic-input"
                  value={remarks}
                  maxLength={500}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {noRouteCard ? (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--amber2)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                }}
              >
                ⚠ No route card for this item —{' '}
                <Link to="/route-cards/new" className="fw-700">
                  create it
                </Link>{' '}
                first.
              </div>
            ) : null}

            {directPurchase ? (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--amber2)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                }}
              >
                ⚠ Direct-purchase items are bought, not produced — this route card cannot raise a
                Production Order.
              </div>
            ) : null}

            {!rawMaterialAvailable ? (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: 'var(--red2)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--red)',
                  borderRadius: 6,
                }}
              >
                ⛔ {NO_RAW_MATERIAL} Tick <span className="fw-700">Raw material available</span>{' '}
                once the store has confirmed it.
              </div>
            ) : null}

            {submitError ? (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  color: 'var(--red2)',
                  background: 'var(--red3)',
                  border: '1px solid var(--red)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                }}
              >
                {submitError}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => exit.leave(goBack)}
                disabled={create.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit || create.isPending}
                title={
                  !plan
                    ? 'Pick a plan first'
                    : noRouteCard
                      ? 'No route card for this item'
                      : !routeCardId
                        ? 'Pick the route card'
                        : directPurchase
                          ? 'Direct-purchase items cannot raise a Production Order'
                          : !targetDate
                            ? 'Set the customer dispatch date'
                            : orderQtyError
                              ? orderQtyError
                              : !rawMaterialAvailable
                                ? NO_RAW_MATERIAL
                                : undefined
                }
              >
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Save
                Production Order &amp; Create JC
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/** Plan Type read off the route card — the same words and colours the Route
 *  Card detail uses (route-cards/routes/detail.tsx). Read-only: it is never
 *  edited from here. */
function PlanTypeChip({ planType }: { planType: PlanType }): React.JSX.Element {
  const label =
    planType === 'full_outsource'
      ? 'Full Outsource'
      : planType === 'direct_purchase'
        ? 'Direct Purchase'
        : planType === 'assembly'
          ? 'Assembly'
          : 'Manufacture';
  const color =
    planType === 'full_outsource'
      ? 'var(--purple)'
      : planType === 'direct_purchase'
        ? 'var(--green)'
        : 'var(--cyan)';
  return (
    <span
      className="fw-700"
      title="Plan Type (from the route card)"
      style={{
        display: 'inline-block',
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 4,
        color,
        border: `1px solid ${color}`,
        verticalAlign: 'middle',
      }}
    >
      {label}
    </span>
  );
}

/** Read-only recap of the picked plan — what the JC will be built for. */
function PlanSummary({ plan }: { plan: PlanPickerItem }): React.JSX.Element {
  const so = plan.soCodeText
    ? `${plan.soCodeText}${plan.lineNo ? ` / line ${plan.lineNo}` : ''}`
    : '—';
  return (
    <div
      style={{
        padding: '8px 12px',
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <div className="form-grid form-grid-4" style={{ gap: 8 }}>
        {/* POL — the line number printed on the CUSTOMER's own purchase order.
            NOT the "/ line n" in SO / JWSO below, which is OUR line number. */}
        <Fact label="POL" value={plan.clientPoLineNo ?? '—'} mono />
        {/* CODE/REV (ADR-177); bare code when the plan's line has no revision. */}
        <Fact
          label="Item"
          value={itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision)}
          mono
        />
        <Fact label="Item Name" value={plan.itemName ?? plan.itemNameText ?? '—'} />
        {/* ADR-182 — Plan Qty and how much of it earlier Production Orders
            already cover. `Pending` is what this order may still be for
            (NAMING.md: never "Remaining" or "Balance"). */}
        <Fact label="Plan Qty" value={String(plan.planQty)} mono />
        <Fact label="Covered" value={String(plan.coveredQty)} mono />
        <Fact label="Pending" value={String(plan.pendingQty)} mono />
        <Fact label="SO / JWSO No." value={so} mono />
        <Fact label="Planned Start" value={fmtDate(plan.plannedStartDate)} mono />
        <Fact label="Planned End" value={fmtDate(plan.plannedEndDate)} mono />
        <Fact label="RM Grade" value={plan.rawMaterialGradeText ?? '—'} />
        <Fact label="RM Size" value={plan.rawMaterialSizeText ?? '—'} />
        {plan.remarks ? (
          <div className="form-full">
            <Fact label="Plan Remark" value={plan.remarks} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        className="text3"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}
      >
        {label}
      </div>
      <div
        className={mono ? 'mono fw-700' : 'fw-700'}
        style={{ fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
