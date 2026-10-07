// The ⋯ menus of a level-2 SO/JWSO Planning line (ADR-199 / owner's row-menu
// spec). planningLineMenu = the line's own ⋯: the six line actions (Plan ·
// Raise PR · BOM Planning · Plan Equipment BOM · Allocate · Release), then, per
// plan of an ORDINARY line, the jumps and the next step (Open JC, Open
// Production Order, Create Route Card, Create Production Order, Create JC /
// Raise PR, Edit plan). On a line WITH BOM parts each plan carries the same
// per-plan items on its own child row instead (planChildMenu) — never both, so
// one action has one place.
//
// Create Route Card (route card pending) was added 2026-10-07 at the owner's
// request; every other condition is the one the old chip buttons carried. Gates
// follow the server: Plan / BOM / Allocate / Raise PR need plan_create entry;
// Release needs edit ("an L2 data-entry planner may book, not un-book",
// plans/service.ts releaseReservation); raising a Production Order is its own
// permission (prodorder_create), the same gate the Plans list uses.
//
// The plan code is in every per-plan label, so a line carrying two or three
// plans still reads unambiguously — on the child rows too, so one label names
// one action wherever it appears.

import type { PlanningDetailResponse, PlanningLine, PlanningPlanSummary } from '@innovic/shared';
import type { RowMenuItem } from '@/ui/data';
import { newProductionOrderTo, newRouteCardTo } from '@/modules/plans/lib/plan-next-step';
import { allocateCap, lineFacts } from './reservation-modals';
import type { ModalState } from './planning-shared';

export interface PlanningLineMenuArgs {
  so: PlanningDetailResponse;
  line: PlanningLine;
  perms: { view: boolean; entry: boolean; edit: boolean };
  /** prodorder_create entry — may this user raise a Production Order? */
  canProductionOrder: boolean;
  /** routecard_create entry — may this user create a Route Card? */
  canCreateRouteCard: boolean;
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

/** The per-plan entries — on the line's ⋯ (ordinary line) or on the plan's
 *  own child row (line with BOM parts). */
function planItems(
  plan: PlanningPlanSummary,
  { perms, canProductionOrder, canCreateRouteCard, setModal, onExecutePlan }: PlanningLineMenuArgs,
): RowMenuItem[] {
  const p = `${plan.code} · `;
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
      // ADR-185 'route_card_pending': the item has no Route Card yet. A card
      // belongs to the ITEM (one per item, server-enforced), so the link
      // carries the item, as the Plans list ⋯ does.
      key: `new-rc-${plan.id}`,
      label: `${p}Create Route Card`,
      icon: 'plus',
      group: 'workflow',
      // No live item → the Route Card form has nothing to bind to; not offered.
      hidden: !(
        isRouteCard &&
        plan.derivedStatus === 'route_card_pending' &&
        plan.itemId &&
        canCreateRouteCard
      ),
      to: newRouteCardTo(plan),
    },
    {
      // ADR-185 derived status 'gen_production_order' = "RC Created": the next
      // step for a route-card plan.
      key: `new-po-${plan.id}`,
      label: `${p}Create Production Order`,
      icon: 'plus',
      group: 'workflow',
      hidden: !(isRouteCard && plan.derivedStatus === 'gen_production_order' && canProductionOrder),
      to: newProductionOrderTo(plan),
    },
    {
      // Old-flow plan: let the work out. A buy / full-outsource plan raises a
      // purchase request, everything else creates the Job Card.
      key: `execute-${plan.id}`,
      label: `${p}${isDP || isFO ? 'Raise PR' : 'Create JC'}`,
      icon: 'play',
      group: 'workflow',
      hidden: !(!isRouteCard && plan.planStatus === 'planned' && perms.edit),
      onSelect: () => onExecutePlan(plan),
    },
    {
      key: `edit-${plan.id}`,
      label: `${p}Edit plan`,
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
      label: `Plan Equipment BOM (${line.bomPartsCount})`,
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
  // On a line with BOM parts every plan has its own ⋯ on its child row
  // (planning-line-expand), so none is repeated here — one place per action.
  const linePlans = hasPartRows(line) ? [] : line.plans;
  // One Route Card per ITEM: two pending plans for one item would otherwise
  // list two "Create Route Card" entries opening the same form.
  const rcItems = new Set<string>();
  const planEntries = linePlans.flatMap((plan) =>
    planItems(plan, args).filter((it) => {
      if (!it.key.startsWith('new-rc-') || it.hidden || !plan.itemId) return true;
      if (rcItems.has(plan.itemId)) return false;
      rcItems.add(plan.itemId);
      return true;
    }),
  );
  return [...lineOwn, ...planEntries];
}

/** A line whose child table lists BOM parts — its plans' actions live on the
 *  child rows. The same test planning-line-expand uses for the part columns. */
export function hasPartRows(line: PlanningLine): boolean {
  return line.bomChildren.length > 0;
}

/**
 * The ⋯ of one row in the line's child-item table: Open the plan, then the
 * step its status allows (Create Route Card → Create Production Order, or for
 * an old-flow plan Create JC / Edit plan), plus Open JC / Open Production
 * Order. A part with NO plan yet offers the window that plans the parts.
 * Only actions whose data this screen loads are offered (CLAUDE.md §20.5):
 * Create/Close Production Order on an In-production plan need Pending qty and
 * Job Card status, which the Planning screen does not load — they stay on
 * the Plans list.
 */
export function planChildMenu(
  plan: PlanningPlanSummary | null,
  partShort: boolean,
  args: PlanningLineMenuArgs,
): RowMenuItem[] {
  const { line, perms, setModal } = args;
  // The part is not fully planned (no plan yet, or ⚠ short): the row that
  // flags the gap offers the window that closes it.
  const planParts: RowMenuItem = {
    key: 'plan-parts',
    label: line.hasEquipmentBom ? 'Plan Equipment BOM' : 'BOM Planning',
    icon: 'package',
    group: 'workflow',
    hidden: !perms.entry || !(line.hasEquipmentBom || line.hasAssemblyBom),
    onSelect: () =>
      setModal({
        kind: line.hasEquipmentBom ? 'equip-bom' : 'assembly-bom',
        soLineId: line.soLineId,
      }),
  };
  if (plan === null) return [planParts];
  return [
    {
      key: `open-plan-${plan.id}`,
      label: `Open ${plan.code}`,
      icon: 'eye',
      group: 'main',
      hidden: !perms.view,
      to: `/plans/${plan.id}`,
    },
    ...planItems(plan, args),
    ...(partShort ? [planParts] : []),
  ];
}
