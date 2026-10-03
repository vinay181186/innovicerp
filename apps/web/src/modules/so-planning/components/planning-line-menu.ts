// The ONE ⋯ menu of a level-2 SO/JWSO Planning line (ADR-199 / owner's row-menu
// spec). Every action a line or any of its plans offers is in here — the six
// line actions the row already had (Plan · Raise PR · BOM Planning · Equipment
// BOM · Allocate · Release), then, per plan, the jumps and the next step that
// used to be buttons inside the plan chip (Open JC, Open Production Order,
// + Production Order, Create JC / Raise PR, Edit plan).
//
// Every condition and every permission gate is the one the buttons carried
// before — nothing new is offered and nothing is quietly withdrawn. Gates
// follow the server: Plan / BOM / Allocate / Raise PR need plan_create entry;
// Release needs edit ("an L2 data-entry planner may book, not un-book",
// plans/service.ts releaseReservation); raising a Production Order is its own
// permission (prodorder_create), the same gate the Plans list uses.
//
// The plan code is in every per-plan label, so a line carrying two or three
// plans still reads unambiguously.

import type { PlanningDetailResponse, PlanningLine, PlanningPlanSummary } from '@innovic/shared';
import type { RowMenuItem } from '@/ui/data';
import { allocateCap, lineFacts } from './reservation-modals';
import type { ModalState } from './planning-shared';

export interface PlanningLineMenuArgs {
  so: PlanningDetailResponse;
  line: PlanningLine;
  perms: { view: boolean; entry: boolean; edit: boolean };
  /** prodorder_create entry — may this user raise a Production Order? */
  canProductionOrder: boolean;
  setModal: (m: ModalState) => void;
  /**
   * Run the plan (create its Job Card / raise its PR). MUST return the
   * mutation's promise: RowMenu only goes busy — and so only blocks a second
   * click — while the promise it was given is pending. A `void` return here is
   * a double-execute waiting to happen. The caller owns the error, so this
   * promise is expected to settle rather than reject.
   */
  onExecutePlan: (plan: PlanningPlanSummary) => Promise<void>;
}

/** The per-plan entries appended after the line's own six. */
function planItems(
  plan: PlanningPlanSummary,
  { perms, canProductionOrder, setModal, onExecutePlan }: PlanningLineMenuArgs,
): RowMenuItem[] {
  const isRouteCard = plan.opsSource === 'route_card';
  const isDP = plan.planType === 'direct_purchase';
  const isFO = plan.planType === 'full_outsource';
  // Gate on the CODE, not the id. Since the soft-delete guards landed
  // (ADR-209), a Job Card that was moved to Trash comes back with jcCode null
  // while plans.jc_id still points at it — offering "Open Job Card" would walk
  // the planner into a dead document.
  const hasJc =
    plan.jcId !== null &&
    plan.jcCode !== null &&
    (plan.planStatus === 'jc_created' ||
      plan.planStatus === 'in_production' ||
      plan.planStatus === 'complete' ||
      isRouteCard);
  return [
    {
      key: `open-jc-${plan.id}`,
      label: `Open ${plan.jcCode ?? ''}`,
      icon: 'activity',
      group: 'main',
      hidden: !hasJc,
      to: `/job-cards/${plan.jcId ?? ''}`,
    },
    {
      key: `open-po-${plan.id}`,
      label: `Open ${plan.productionOrderCode ?? 'Production Order'}`,
      icon: 'eye',
      group: 'main',
      hidden: !(isRouteCard && plan.productionOrderId && plan.productionOrderCode),
      to: `/production-orders/${plan.productionOrderId ?? ''}`,
    },
    {
      // ADR-185 derived status 'gen_production_order' = "RC Created": the next
      // step for a route-card plan.
      key: `new-po-${plan.id}`,
      label: `${plan.code} · + Production Order`,
      icon: 'plus',
      group: 'workflow',
      hidden: !(isRouteCard && plan.derivedStatus === 'gen_production_order' && canProductionOrder),
      to: `/production-orders/new?planId=${encodeURIComponent(plan.id)}&planCode=${encodeURIComponent(plan.code)}`,
    },
    {
      // Old-flow plan: let the work out. A buy / full-outsource plan raises a
      // purchase request, everything else creates the Job Card.
      key: `execute-${plan.id}`,
      label: `${plan.code} · ${isDP || isFO ? 'Raise PR' : 'Create JC'}`,
      icon: 'play',
      group: 'workflow',
      hidden: !(!isRouteCard && plan.planStatus === 'planned' && perms.edit),
      onSelect: () => onExecutePlan(plan),
    },
    {
      key: `edit-${plan.id}`,
      label: `${plan.code} · Edit plan`,
      icon: 'pencil',
      group: 'workflow',
      hidden: !(
        !isRouteCard &&
        (plan.planStatus === 'in_planning' || plan.planStatus === 'planned') &&
        perms.edit
      ),
      onSelect: () => setModal({ kind: 'edit', planId: plan.id }),
    },
  ];
}

export function planningLineMenu(args: PlanningLineMenuArgs): RowMenuItem[] {
  const { so, line, perms, setModal } = args;
  const cap = line.itemId ? allocateCap(lineFacts(so.soCode, line, so.soInternalNo)) : 0;
  // The line's own six — every item opens its modal (each modal guards its own
  // save). Copied unchanged from the row this table replaced.
  const lineOwn: RowMenuItem[] = [
    {
      key: 'create',
      label: `Plan ${line.remaining}`,
      icon: 'plus',
      group: 'workflow',
      hidden:
        !perms.entry ||
        line.itemProcurementType === 'buy' ||
        line.hasEquipmentBom ||
        line.remaining <= 0,
      onSelect: () => setModal({ kind: 'create', soLineId: line.soLineId }),
    },
    {
      // ADR-171: a BUY line is purchased, not planned. A JWSO line is the
      // customer's own material and is never bought in.
      key: 'raise-pr',
      label: `Raise PR (${line.remaining})`,
      icon: 'plus',
      group: 'workflow',
      hidden:
        !perms.entry ||
        line.itemProcurementType !== 'buy' ||
        so.source === 'jw' ||
        line.remaining <= 0,
      onSelect: () => setModal({ kind: 'raise-pr', soLineId: line.soLineId }),
    },
    {
      key: 'assembly-bom',
      label: `BOM Planning (${line.bomPartsCount})`,
      icon: 'package',
      group: 'workflow',
      hidden: !perms.entry || !line.hasAssemblyBom,
      onSelect: () => setModal({ kind: 'assembly-bom', soLineId: line.soLineId }),
    },
    {
      key: 'equip-bom',
      label: `Equipment BOM (${line.bomPartsCount})`,
      icon: 'package',
      group: 'workflow',
      hidden: !perms.entry || !line.hasEquipmentBom,
      onSelect: () => setModal({ kind: 'equip-bom', soLineId: line.soLineId }),
    },
    {
      // ADR-180: book free stock to this line. Does not move Physical stock.
      key: 'allocate',
      label: 'Allocate',
      icon: 'package',
      group: 'workflow',
      hidden: !perms.entry || !line.itemId,
      disabledReason: cap <= 0 ? 'Nothing to allocate' : undefined,
      onSelect: () => setModal({ kind: 'allocate', soLineId: line.soLineId }),
    },
    {
      // ADR-180: give a booking back. Does not move Physical stock.
      key: 'release',
      label: `Release (${line.reservedQty} reserved)`,
      icon: 'refresh-cw',
      group: 'workflow',
      hidden: !perms.edit || line.reservedQty <= 0,
      onSelect: () => setModal({ kind: 'release', soLineId: line.soLineId }),
    },
  ];
  return [...lineOwn, ...line.plans.flatMap((p) => planItems(p, args))];
}
