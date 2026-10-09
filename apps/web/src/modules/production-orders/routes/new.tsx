// Create Production Order (ADR-170, ADR-182): Plan + Route Card + PRO Qty +
// PRO Target Date (owner label 2026-09-30, was "Customer Dispatch Date"; the
// wire field stays `targetDate`) → Create JC. The customer's own date shows
// read-only as "Customer Dispatch Date" in the Schedule row.
//
// ADR-182 added three things to this screen:
//   • PRO Qty (wire `orderQty`) — a plan may be covered by SEVERAL orders now
//     (50 = 20+20+10), so the screen asks how many pieces THIS order is for. It
//     defaults to the plan's `Pending` (NAMING.md — never "Remaining"/"Balance")
//     and is capped there; the server re-checks the cap under the plan's row lock.
//   • Raw material available — the shop floor confirms the material is on hand
//     BEFORE the order is raised. Unticked, Save is off and its reason says
//     exactly what the server would.
//   • Actual Size — the size really cut, beside the plan's master-picked size.
//     Carried onto the Job Card so the traveller prints what was actually used.
//
// The plan picker lists route-card-driven plans that still have Pending qty.
// The Route Card is the ONLY source of operations — "no route card,
// no way forward" — so with none for the item Save stays off and the screen
// says where to make one. The PRO No is a read-only preview of the next number
// in the header; the server assigns the real one.
//
// Layout (owner-approved mock-up pro-routecard-create-edit-mockup.html, frame
// "1 · Production Order — Create", 2026-10-06): the page fits one 1440×810
// screen with no page scroll, on the SAME grid and cluster order as the
// Production Order detail page — only the controls differ. Header (next no.,
// Cancel, Save) → identity line filled from the Plan → Order · Quantity ·
// Schedule · Material clusters → ONE read-only panel of the Route Card's
// operations that takes the height left. The decision is WHICH PLAN: the Plan
// No. cell carries the blue rule and every other input is off until a plan is
// picked. The Quantity row reads Plan Qty − Covered = Pending and ends on the
// PRO Qty typed (green rule).
//
// Gate + exit guard follow tpi-masters/routes/new.tsx. No Close button here on
// purpose: closing is its own screen (Production → Entry → Close Production
// Order) and its own permission (edit).

import type { CreateProductionOrderInput, RouteCardListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { useRouteCardsList } from '@/modules/route-cards/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentCode,
  IdentSep,
} from '@/ui/forms';
import { DetailHeader, useSaveShortcut } from '@/ui/layout';
import {
  type PlanPickerItem,
  useCreateProductionOrder,
  useNextProductionOrderCode,
  usePreselectedPlan,
} from '../api';
import { PlanPicker } from '../components/plan-picker';
import { PoCreateOpsPanel } from '../components/po-create-ops-panel';
import '../components/po-create.css';

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

/** What every input says until the one decision — the Plan — is made. */
const PICK_PLAN_FIRST = 'Pick a plan first';
/** The tick's full sentence; the cell itself says "In store". */
const IN_STORE_SENTENCE = 'The material for this order is in the store';

function ProductionOrderNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = productionOrderNewRoute.useSearch();
  const preselected = usePreselectedPlan(search.planId, search.planCode, 'create');
  const saveKey = useSaveKey();
  const create = useCreateProductionOrder(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/production-orders' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Tier-driven, per department (Production). Entry raises a PO; the gate stops
  // the form appearing when the URL is typed directly by a viewer.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');
  // Created By — the signed-in user, who the server records as the creator.
  const { data: me } = useSession();

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
  // Skip while the list still shows the PREVIOUS plan's cards (the hook keeps
  // them as placeholder data during the refetch) — else the old item's card
  // gets picked under the new plan.
  useEffect(() => {
    if (routeCards.isPlaceholderData) return;
    if (rcItems.length === 1) setRouteCardId(rcItems[0]?.id ?? null);
  }, [rcItems, routeCards.isPlaceholderData]);

  const onPickPlan = (p: PlanPickerItem | null): void => {
    setPlan(p);
    setRouteCardId(null);
    // PRO Target Date starts at the plan's Customer Dispatch Date; an older
    // plan without one falls back to its Planned End, as before.
    setTargetDate(p?.customerDispatchDate ?? p?.plannedEndDate ?? '');
    // ADR-182 — the usual answer is "all that is left", so PRO Qty starts at
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
  // refuses it too) — Save stays off with the reason shown.
  const directPurchase = routeCard?.planType === 'direct_purchase';

  // ADR-182 — PRO Qty. Pending is the ceiling the server enforces under the
  // plan's row lock; the field simply refuses to ask for more. The Pending
  // cell beside it is that same ceiling, so the row states the enforced cap.
  const pendingQty = plan?.pendingQty ?? 0;
  const orderQty = Number.parseInt(orderQtyText, 10);
  const orderQtyValid = Number.isInteger(orderQty) && orderQty > 0 && orderQty <= pendingQty;
  const orderQtyError = !plan
    ? null
    : pendingQty === 0
      ? `Plan ${plan.code} is fully covered by its Production Orders (${plan.planQty} of ${plan.planQty}).`
      : orderQtyText.trim() === ''
        ? 'PRO Qty is required.'
        : !orderQtyValid
          ? orderQty > pendingQty
            ? `PRO Qty cannot be more than Pending (${pendingQty}).`
            : 'PRO Qty must be a whole number greater than 0.'
          : null;
  // The server's exact words, said here first so the user never meets it as an
  // error after a click (production-orders/service.ts).
  const NO_RAW_MATERIAL =
    'Raw Material Available is required. Tick it once the store confirms the material.';

  // The PLAN is the only source of raw material for this order: the Production
  // Order and its Job Card copy the Grade and Size off the plan, never off the
  // route card. A plan saved before its route card existed can carry neither
  // (PLN-0001 on production: both null) and the Material row would show that as
  // a bare "—" with no explanation — the material simply looked like it had not
  // loaded. Say it instead, and refuse the confirmation tick: "material is in
  // the store" against a plan that names no material confirms nothing.
  const planHasRmGrade = Boolean(
    plan && (plan.rawMaterialGradeText?.trim() || plan.rawMaterialGradeId),
  );
  const planHasRmSize = Boolean(
    plan && (plan.rawMaterialSizeText?.trim() || plan.rawMaterialSizeId),
  );
  const planHasNoRawMaterialRaw = Boolean(plan) && !planHasRmGrade && !planHasRmSize;
  // ADR-225 phase 4: a plan raised from a Multi-Level Plan row that has child
  // rows (a sub-assembly or the top assembly) needs no raw material — the
  // server decides and says so in `mlIsAssembly`. A leaf part raised from a
  // Multi-Level Plan still needs RM, so it keeps the block like every plan.
  const planHasNoRawMaterial = planHasNoRawMaterialRaw && !plan?.mlIsAssembly;
  const NO_PLAN_RAW_MATERIAL =
    // ADR-218 — must match the server's wording in production-orders/service.ts.
    "This plan has no raw material — fill RM Grade and RM Size on the item's Route Card (or on its BOM line), then open the plan and save it again.";

  const canSubmit =
    Boolean(plan) &&
    Boolean(routeCardId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
    orderQtyValid &&
    rawMaterialAvailable &&
    !planHasNoRawMaterial &&
    !noRouteCard &&
    !directPurchase;

  const save = async (): Promise<void> => {
    if (!plan || !routeCardId || !canSubmit || create.isPending) return;
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
  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await save();
  };
  // Ctrl+S runs the same Save as the header button (off while it is disabled).
  useSaveShortcut(() => void save(), canSubmit && !create.isPending);

  // Why Save is off — the header button's tooltip. The "Raw Material Available
  // is required" message used to be a red banner that showed the moment the
  // page opened; it is this tooltip now, in its turn after the fields above it.
  const saveBlockedReason = !plan
    ? 'Plan is required.'
    : noRouteCard
      ? 'No Route Card for this item.'
      : !routeCardId
        ? 'Route Card is required.'
        : directPurchase
          ? 'Buy item — no Production Order.'
          : !targetDate
            ? 'PRO Target Date is required.'
            : orderQtyError
              ? orderQtyError
              : planHasNoRawMaterial
                ? NO_PLAN_RAW_MATERIAL
                : !rawMaterialAvailable
                  ? NO_RAW_MATERIAL
                  : undefined;

  // FLOW FIX: "create it" opens the Route Card form already on this plan's
  // item (route-cards/new reads ?itemId=&itemCode=&itemName=), so the planner
  // does not pick again the item the plan already names.
  const planItemCode = plan ? (plan.itemCode ?? plan.itemCodeText) : null;
  const planItemName = plan ? (plan.itemName ?? plan.itemNameText) : null;
  const newRouteCardSearch = {
    ...(plan?.itemId ? { itemId: plan.itemId } : {}),
    ...(planItemCode ? { itemCode: planItemCode } : {}),
    ...(planItemName ? { itemName: planItemName } : {}),
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
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to create Production Orders. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  const off = !plan;
  const createdBy = me ? (me.fullName?.trim() ? me.fullName : me.email) : null;
  const rmItem = plan?.rawMaterialItemCode ?? null;
  const rmGrade = plan?.rawMaterialGradeText ?? null;
  const rmSize = plan?.rawMaterialSizeText ?? null;
  const rmQtyPerPiece = plan?.rmQtyPerPiece ?? null;
  const rmTickTitle = planHasNoRawMaterial ? NO_PLAN_RAW_MATERIAL : IN_STORE_SENTENCE;

  return (
    <form className="page-fill po-create" onSubmit={(e) => void onSubmit(e)}>
      {exit.dialog}
      <DetailHeader
        backLabel="Back"
        onBack={goBack}
        code={nextCode.data?.code ?? (nextCode.isLoading ? '…' : 'IN-PRO-?????')}
        // One header line, as the mock-up draws it: next no. · document name.
        // `badges`, not `name`: `name` takes a second line this page has no
        // height for.
        badges={
          <>
            <span
              className="po-create-next"
              title="A preview — the server assigns the real number on Save"
            >
              next no.
            </span>
            <span className="panel-title">New Production Order</span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => exit.leave(goBack)}
              disabled={create.isPending}
            >
              Cancel
            </button>
            {/* The wrapper carries the reason too: a disabled button gets no
                hover in every browser. */}
            <span title={saveBlockedReason}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canSubmit || create.isPending}
                title={saveBlockedReason}
              >
                {create.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>Save Production Order &amp; Create JC</>
                )}
              </button>
            </span>
          </>
        }
      >
        {/* What stops Save, under the header where the Save button is. */}
        {noRouteCard ? (
          <Banner tone="warn" role="alert">
            ⚠ No Route Card for this item —{' '}
            <Link to="/route-cards/new" search={newRouteCardSearch} className="fw-700">
              create it
            </Link>{' '}
            first.
          </Banner>
        ) : null}
        {directPurchase ? (
          <Banner tone="warn" role="alert">
            ⚠ Item {planItemCode ?? ''} is a Buy item — no Production Order.
          </Banner>
        ) : null}
        {planHasNoRawMaterial ? (
          <Banner tone="warn" role="alert">
            ⚠ {NO_PLAN_RAW_MATERIAL}
          </Banner>
        ) : null}
        {submitError ? (
          <Banner tone="error" role="alert">
            {submitError}
          </Banner>
        ) : null}

        {/* WHICH plan line this order is for — filled from the Plan. Identity,
            not facts, so it heads the grid instead of taking cells. */}
        <DocIdent>
          {plan ? (
            <>
              {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
              <IdentCode>{itemCodeWithRev(planItemCode, plan.itemRevision)}</IdentCode>
              {planItemName ? <span>{planItemName}</span> : null}
              {plan.soCodeText ? (
                <>
                  <IdentSep />
                  {/* ADR-207 — the system SO No. then the SO's own office number. */}
                  <IdentCode>{soNoWithInternal(plan.soCodeText, plan.soInternalNo)}</IdentCode>
                  {/* Ln is OUR sales-order line number. POL is the line number
                      printed on the CUSTOMER's own purchase order. Never the
                      same fact. */}
                  {plan.lineNo ? <span>Ln {plan.lineNo}</span> : null}
                  {plan.clientPoLineNo ? (
                    <span>
                      POL <b className="po-create-pol">{plan.clientPoLineNo}</b>
                    </span>
                  ) : null}
                </>
              ) : null}
              <span className="po-create-from">· filled from the Plan</span>
            </>
          ) : (
            <span className="po-create-from">
              Pick a plan — the item, SO line and POL fill in from it.
            </span>
          )}
        </DocIdent>

        <ClusterGrid>
          {/* When it is raised, by whom, from which Plan and Route Card. The
              Plan is the one decision on this screen — the blue rule. */}
          <Cluster name="Order">
            <ClusterFact num label="Production Order Date" value={fmtDate(todayLocal())} />
            <ClusterFact
              className="po-create-one-line"
              label="Created By"
              empty={!createdBy}
              title={createdBy ?? undefined}
              value={createdBy ?? '—'}
            />
            <FormField label="Plan No." required htmlFor="po-plan" className="po-in po-create-act">
              <PlanPicker
                id="po-plan"
                mode="create"
                bare
                codeOnly
                className="po-create-ctl"
                value={plan?.id ?? null}
                onChange={onPickPlan}
                fallbackLabel={plan ? plan.code : undefined}
              />
            </FormField>
            <FormField label="Route Card" required htmlFor="po-route-card" className="po-in">
              <select
                id="po-route-card"
                className="innovic-select"
                value={routeCardId ?? ''}
                disabled={!plan || noRouteCard || routeCards.isLoading}
                title={
                  routeCard
                    ? `${routeCard.code} · Route Card Rev ${routeCard.currentRevision}`
                    : undefined
                }
                onChange={(e) => setRouteCardId(e.target.value || null)}
              >
                <option value="">
                  {!plan
                    ? PICK_PLAN_FIRST
                    : routeCards.isLoading
                      ? 'Loading Route Cards…'
                      : noRouteCard
                        ? 'No Route Card for this item'
                        : 'Select Route Card…'}
                </option>
                {/* The box holds the code only. "IN-RC-00012 · Route Card Rev 2"
                    needs ~175px and the quarter cell gives the box 167px at
                    1440 wide, so the revision was the part cut off; the bare
                    "Rev" that would fit is not a name NAMING.md allows. The
                    revision is in the box's hover text and in the operations
                    panel's header right below. */}
                {rcItems.map((rc) => (
                  <option
                    key={rc.id}
                    value={rc.id}
                    title={`${rc.code} · Route Card Rev ${rc.currentRevision}`}
                  >
                    {rc.code}
                  </option>
                ))}
              </select>
            </FormField>
          </Cluster>

          {/* How much — Plan Qty − Covered = Pending, then the PRO Qty this
              order is for, which starts at Pending and cannot go over it
              (ADR-182; the server re-checks under the plan's row lock, so two
              people ordering at once cannot both fit). `PRO Qty`, not a bare
              `Order Qty` — it sits beside Plan Qty (NAMING.md). */}
          <Cluster name="Quantity">
            <ClusterFact
              num
              label="Plan Qty"
              empty={!plan}
              title="What the plan covers"
              value={plan ? plan.planQty : '—'}
            />
            <ClusterFact
              num
              label="Covered"
              empty={!plan}
              title="Already on earlier Production Orders"
              value={plan ? plan.coveredQty : '—'}
            />
            <ClusterFact
              num
              label="Pending"
              empty={!plan}
              title="Plan Qty − Covered: the most this order can be for"
              value={plan ? plan.pendingQty : '—'}
            />
            <FormField
              label="PRO Qty"
              required
              htmlFor="po-order-qty"
              className="po-in cl-lead"
              error={orderQtyError ?? undefined}
            >
              <input
                id="po-order-qty"
                type="number"
                className="innovic-input cl-num"
                value={orderQtyText}
                min={1}
                max={pendingQty || undefined}
                step={1}
                disabled={!plan || pendingQty === 0}
                title={plan ? `1 to ${pendingQty} — no more than Pending` : undefined}
                onChange={(e) => setOrderQtyText(e.target.value)}
                placeholder={plan ? String(pendingQty) : PICK_PLAN_FIRST}
              />
            </FormField>
          </Cluster>

          {/* The dates in the order they happen: the plan's window, this
              order's own target, then the date the CUSTOMER expects it (the
              SO / JWSO line's due date). PRO Target Date starts at the plan's
              Customer Dispatch Date. */}
          <Cluster name="Schedule">
            <ClusterFact
              num
              label="Plan Start Date"
              empty={!plan?.plannedStartDate}
              value={fmtDate(plan?.plannedStartDate)}
            />
            <ClusterFact
              num
              label="Plan End Date"
              empty={!plan?.plannedEndDate}
              value={fmtDate(plan?.plannedEndDate)}
            />
            <FormField label="PRO Target Date" required htmlFor="po-target-date" className="po-in">
              <input
                id="po-target-date"
                type="date"
                className="innovic-input"
                value={targetDate}
                disabled={off}
                title={off ? PICK_PLAN_FIRST : undefined}
                onChange={(e) => setTargetDate(e.target.value)}
                required
              />
            </FormField>
            <ClusterFact
              num
              label="Customer Dispatch Date"
              empty={!plan?.lineDueDate}
              value={fmtDate(plan?.lineDueDate)}
            />
          </Cluster>

          {/* Material — what the Plan says (the PLAN is the only source of raw
              material for this order), then the shop floor's own answers. */}
          <Cluster name="Material">
            <ClusterFact
              num
              label="RM Item"
              empty={!rmItem}
              title={rmItem ?? undefined}
              value={rmItem ?? '—'}
            />
            <ClusterFact
              className="po-create-one-line"
              label="RM Grade"
              empty={!rmGrade}
              title={rmGrade ?? undefined}
              value={rmGrade ?? '—'}
            />
            <ClusterFact
              className="po-create-one-line"
              label="RM Size"
              empty={!rmSize}
              title={rmSize ?? undefined}
              value={rmSize ?? '—'}
            />
            <ClusterFact
              num
              label="RM Qty / piece"
              empty={rmQtyPerPiece == null}
              value={rmQtyPerPiece ?? '—'}
            />
          </Cluster>
          <Cluster name={null}>
            {/* ADR-182 — what the store really had / really cut, beside the
                plan's master-picked RM Size. Optional free text. */}
            <FormField label="Actual Size" htmlFor="po-actual-size" className="po-in">
              <input
                id="po-actual-size"
                className="innovic-input"
                value={actualSize}
                maxLength={120}
                disabled={off}
                placeholder={off ? PICK_PLAN_FIRST : undefined}
                onChange={(e) => setActualSize(e.target.value)}
              />
            </FormField>
            {/* ADR-182 — the shop floor's confirmation that the material is on
                hand. The server refuses a false value in the words Save's
                tooltip already gives. */}
            <FormField
              label="Raw Material Available"
              required
              htmlFor="po-rm-available"
              className="po-in"
            >
              <label
                className="check-row po-create-tick"
                title={off ? PICK_PLAN_FIRST : rmTickTitle}
                aria-disabled={off || planHasNoRawMaterial ? true : undefined}
              >
                <input
                  id="po-rm-available"
                  type="checkbox"
                  checked={rawMaterialAvailable}
                  disabled={off || planHasNoRawMaterial}
                  title={off ? PICK_PLAN_FIRST : rmTickTitle}
                  aria-label={IN_STORE_SENTENCE}
                  onChange={(e) => setRawMaterialAvailable(e.target.checked)}
                />
                <span>In store</span>
              </label>
            </FormField>
            <FormField label="Remarks" htmlFor="po-remarks" className="po-in cl-span-2">
              <input
                id="po-remarks"
                className="innovic-input"
                value={remarks}
                maxLength={500}
                disabled={off}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder={off ? PICK_PLAN_FIRST : 'Optional'}
              />
            </FormField>
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      {/* The one block that takes the height left: the operations the Job
          Card will copy. Read-only; its table is the page's only scrollbar. */}
      <PoCreateOpsPanel
        hasPlan={Boolean(plan)}
        routeCard={routeCard}
        noRouteCard={noRouteCard}
        routeCardsLoading={Boolean(planItemId) && routeCards.isLoading}
        planRemarks={plan?.remarks ?? null}
      />
    </form>
  );
}
