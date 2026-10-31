// Plans list — the fit table's columns, row tint and ⋯ menu (ADR-199; the ▸ detail is
// in plan-expanded.tsx). Split out of routes/list.tsx so that file stays
// under the 400-line ceiling and the sheet is defined in one place.
//
// One row per plan, every visible fact its own one-line column (the stacked
// Plan # / date / type card cell of the retired sheet is gone). The first
// column (Plan No.) is always pinned and carries the fit table's ▸ — the row's
// one expand control, which opens the secondary facts (POL, SO/JWSO, Order Qty,
// Covered, PRO No., JC No., Dispatch date). Labels per docs/NAMING.md.

import { type ListPlansResponse, type PlanStatus, type PlanType } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import { itemCodeWithRev, docDrawingRev } from '@/lib/item-code';
import { ROW_TINT, leadColumns } from '@/ui/data';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import type { RenderLink } from '@/ui/layout';
import { DERIVED_BADGE, DERIVED_LABEL, STORED_BADGE } from '../lib/derived-status';
import {
  newProductionOrderTo,
  newRouteCardTo,
  routeCardForItemTo,
  withQuery,
} from '../lib/plan-next-step';

type PlanRow = ListPlansResponse['items'][number];

// Colours from the one STORED_BADGE map the plan detail also reads.
export const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: STORED_BADGE.in_planning, label: 'In Planning' },
  planned: { cls: STORED_BADGE.planned, label: 'Planned' },
  jc_created: { cls: STORED_BADGE.jc_created, label: 'JC Created' },
  pr_created: { cls: STORED_BADGE.pr_created, label: 'PR Created' },
  in_production: { cls: STORED_BADGE.in_production, label: 'In Production' },
  complete: { cls: STORED_BADGE.complete, label: 'Completed' },
  cancelled: { cls: STORED_BADGE.cancelled, label: 'Cancelled' },
};

const TYPE_LABEL: Record<PlanType, string> = {
  manufacture: 'Manufacture',
  direct_purchase: 'Buy',
  full_outsource: 'Full Outsource',
  assembly: 'Assembly',
};

const TYPE_ICON: Record<PlanType, string> = {
  manufacture: '🏭',
  direct_purchase: '🛒',
  full_outsource: '📦',
  assembly: '🔧',
};

// Sort & Filter (server mode) tick lists — stored code + the label shown.
const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as PlanType[]).map((value) => ({
  value,
  label: TYPE_LABEL[value],
}));
// The effective status the row shows (ADR-185): stored labels for old plans,
// plus the two route-card states that have no stored twin.
const STATUS_OPTIONS = [
  ...(Object.keys(STATUS_BADGE) as PlanStatus[]).map((value) => ({
    value,
    label: STATUS_BADGE[value].label,
  })),
  { value: 'route_card_pending', label: DERIVED_LABEL.route_card_pending },
  {
    value: 'route_card_approval_pending',
    label: DERIVED_LABEL.route_card_approval_pending,
  },
  { value: 'gen_production_order', label: DERIVED_LABEL.gen_production_order },
];

/** The status badge the row shows: derived for route-card plans, the stored
 *  label for old (ops_source 'plan') plans. */
function planBadge(row: PlanRow): { cls: string; label: string } {
  return row.derivedStatus
    ? { cls: DERIVED_BADGE[row.derivedStatus], label: DERIVED_LABEL[row.derivedStatus] }
    : STATUS_BADGE[row.planStatus];
}

/**
 * Whole-row wash by the REAL status enums only (ADR-199 ROW_TINT):
 *   cancelled                                   → cancelled (grey)
 *   complete / derived production_complete      → done      (green)
 *   in_planning / derived route_card_pending    → pending   (amber, not started)
 *   everything else (under way)                 → no wash
 */
export function planRowTint(row: PlanRow): string | undefined {
  if (row.planStatus === 'cancelled') return ROW_TINT.cancelled;
  if (row.derivedStatus === 'production_complete' || row.planStatus === 'complete')
    return ROW_TINT.done;
  if (
    row.derivedStatus === 'route_card_pending' ||
    row.derivedStatus === 'route_card_approval_pending' ||
    (!row.derivedStatus && row.planStatus === 'in_planning')
  )
    return ROW_TINT.pending;
  return undefined;
}

export function plansListColumns(
  /** ADR-202 — plan ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<PlanRow>[] {
  return [
    ...leadColumns<PlanRow>({
      doc: {
        id: 'plan_no',
        sortFilterField: 'code',
        header: 'Plan No.',
        nowrap: true,
        // The row's ▸ (fit engine) opens the detail reveal; the Plan No. link
        // opens the plan page. stopPropagation on the link, not the cell, so
        // clicking the rest of the cell still opens the row.
        render: (row) => (
          <Link
            to="/plans/$id"
            params={{ id: row.id }}
            className="td-code"
            title="Open the plan"
            onClick={(e) => e.stopPropagation()}
          >
            {row.code}
          </Link>
        ),
      },
      soNo: (row) => row.soCodeText,
      internalSoNo: (row) => row.soInternalNo,
      pol: (row) => row.clientPoLineNo,
      createdOn: (row) => row.createdAt,
      itemCode: (row) => (row.itemCode ?? row.itemCodeText) as string | null,
      itemRev: (row) => docDrawingRev(row),
      itemName: (row) => row.itemName ?? row.itemNameText,
      overrides: {
        so_no: { sortFilterField: 'soCodeText' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        item_code: {
          sortFilterField: 'itemCode',
          // `CODE/REV` — the customer's drawing revision from the SO line this plan
          // was raised against; a JW-sourced or ad-hoc plan keeps the bare code.
          render: (row) => (
            <ItemRevLink
              itemRevisionId={row.itemRevisionId}
              label={itemCodeWithRev(
                (row.itemCode ?? row.itemCodeText) as string | null,
                docDrawingRev(row),
              )}
              className=""
            />
          ),
        },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'plan_date',
      sortFilterField: 'planDate',
      kind: 'date',
      header: 'Plan Date',
      className: 'mono text2',
      nowrap: true,
      render: (row) => fmtDate(row.planDate),
    },
    {
      // NAMING.md "Plan End Date" — plans.planned_end_date; blank on a plan
      // saved without a schedule.
      id: 'planned_end_date',
      sortFilterField: 'plannedEndDate',
      kind: 'date',
      header: 'Plan End Date',
      className: 'mono text2',
      nowrap: true,
      render: (row) => fmtDate(row.plannedEndDate),
    },
    {
      id: 'plan_type',
      sortFilterField: 'planType',
      filterOptions: TYPE_OPTIONS,
      kind: 'badge',
      header: 'Plan Type',
      nowrap: true,
      render: (row) => (
        <span className="badge b-grey">
          {TYPE_ICON[row.planType]} {TYPE_LABEL[row.planType]}
        </span>
      ),
    },
    {
      id: 'plan_qty',
      sortFilterField: 'planQty',
      filterType: 'num',
      header: 'Plan Qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (row) => row.planQty,
    },
    {
      id: 'pending_qty',
      sortFilterField: 'pendingQty',
      filterType: 'num',
      header: 'Pending',
      align: 'right',
      className: 'mono fw-700',
      headColor: 'var(--red)',
      nowrap: true,
      // ADR-182 — what a new Production Order may still be raised for (NAMING.md
      // "Pending"). Only route-card plans carry orders, so only they show it.
      render: (row) =>
        row.derivedStatus ? (
          <span style={{ color: row.pendingQty > 0 ? 'var(--amber)' : 'var(--green)' }}>
            {row.pendingQty}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'plan_status',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'Plan Status',
      nowrap: true,
      render: (row) => {
        // ADR-202 — a pending edit overlays grey "Draft" in place of the status.
        if (draftIds?.has(row.id))
          return (
            <span className="badge b-grey" title="An edit to this document is waiting for approval">
              Draft
            </span>
          );
        const badge = planBadge(row);
        return <span className={`badge ${badge.cls}`}>{badge.label}</span>;
      },
    },
  ];
}

/** The ⋯ menu's link renderer: the Create … steps carry a query string
 *  (`/production-orders/new?planId=…`), and the router's <Link> wants it as
 *  `search`, so it is split off here. */
export const renderPlanLink: RenderLink = ({ to, ...rest }) => {
  const q = to.indexOf('?');
  if (q < 0) return <Link {...rest} to={to} />;
  const search = Object.fromEntries(new URLSearchParams(to.slice(q + 1)));
  return <Link {...rest} to={to.slice(0, q)} search={search} />;
};

/**
 * The row's ⋯ menu (owner-approved spec 2026-10-01): the step that moves the
 * plan out of the state it shows, under "Workflow". Same steps, links and gates
 * as before. An item the user has no right to is left out; one the server would
 * refuse for this plan's state is greyed with why.
 */
export function planRowMenu(
  row: PlanRow,
  opts: {
    canCreateRouteCard: boolean;
    /** routecard_create view — may open Route Card Master (ADR-253 next step). */
    canViewRouteCard: boolean;
    canProductionOrder: boolean;
    canCloseProductionOrder: boolean;
    /** ADR-234 — may open the Job Card page (Job Card View). */
    canOpenJobCard: boolean;
  },
): RowMenuItem[] {
  const newPoTo = newProductionOrderTo(row);
  if (row.derivedStatus === 'route_card_pending') {
    return [
      {
        key: 'create-route-card',
        label: 'Create Route Card',
        icon: 'plus',
        group: 'workflow',
        hidden: !opts.canCreateRouteCard,
        to: newRouteCardTo(row),
      },
    ];
  }
  // ADR-253 — the item's card exists but waits for approval; a Production
  // Order is refused until then, so the next step is the card, not Create PO.
  if (row.derivedStatus === 'route_card_approval_pending') {
    return [
      {
        key: 'open-route-card',
        label: 'Open Route Card',
        icon: 'eye',
        group: 'workflow',
        hidden: !opts.canViewRouteCard,
        to: routeCardForItemTo(row),
      },
    ];
  }
  if (row.derivedStatus === 'gen_production_order') {
    return [
      {
        key: 'create-po',
        label: 'Create Production Order',
        icon: 'plus',
        group: 'workflow',
        hidden: !opts.canProductionOrder,
        to: newPoTo,
      },
    ];
  }
  if (row.derivedStatus !== 'in_production') return [];
  // ADR-182 — a plan part-covered by earlier orders still needs one for its
  // Pending qty; with nothing Pending the server refuses a new order.
  const nothingPending = row.pendingQty > 0 ? undefined : 'Nothing Pending';
  // Close only once the Job Card has finished — before that the server refuses.
  const jcDone = row.jcStatus === 'complete' || row.jcStatus === 'closed';
  return [
    {
      key: 'create-po',
      label: 'Create Production Order',
      icon: 'plus',
      group: 'workflow',
      hidden: !opts.canProductionOrder,
      disabledReason: nothingPending,
      ...(nothingPending ? {} : { to: newPoTo }),
    },
    {
      // The Job Card: status, then Op Entry from there. Named for the page it
      // OPENS (ADR-234) — it used to read "Op Entry" but lands on the Job Card.
      key: 'open-jc',
      label: 'Open Job Card',
      icon: 'eye',
      group: 'workflow',
      hidden: !row.jcId || !opts.canOpenJobCard,
      to: row.jcId ? `/job-cards/${row.jcId}` : undefined,
    },
    {
      key: 'close-po',
      label: 'Close Production Order',
      icon: 'lock',
      group: 'workflow',
      // ADR-231 — Close is an Advance on Production Orders, not an Entry.
      hidden: !opts.canCloseProductionOrder,
      disabledReason: jcDone ? undefined : 'Job Card not complete',
      ...(jcDone
        ? { to: withQuery('/production-orders/close', { planId: row.id, planCode: row.code }) }
        : {}),
    },
  ];
}
