// Plans list — the fit table's columns, row tint, ▸ detail and ⋯ menu (ADR-199
// table standard 2026-10-01). Split out of routes/list.tsx so that file stays
// under the 400-line ceiling and the sheet is defined in one place.
//
// One row per plan, every visible fact its own one-line column (the stacked
// Plan # / date / type card cell of the retired sheet is gone). The first
// column (Plan No.) is always pinned and carries the fit table's ▸ — the row's
// one expand control, which opens the secondary facts (POL, SO/JWSO, Order Qty,
// Covered, PRO No., JC No., Dispatch date). Labels per docs/NAMING.md.

import {
  PRODUCTION_ORDER_STATUS_LABEL,
  type ListPlansResponse,
  type PlanStatus,
  type PlanType,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { ROW_TINT } from '@/ui/data';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import type { RenderLink } from '@/ui/layout';
import { DERIVED_BADGE, DERIVED_LABEL, STORED_BADGE } from '../lib/derived-status';

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
    (!row.derivedStatus && row.planStatus === 'in_planning')
  )
    return ROW_TINT.pending;
  return undefined;
}

export function plansListColumns(): DataTableColumn<PlanRow>[] {
  return [
    {
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
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      className: 'mono fw-700',
      nowrap: true,
      // `CODE/REV` — the customer's drawing revision from the SO line this plan
      // was raised against; a JW-sourced or ad-hoc plan keeps the bare code.
      render: (row) =>
        itemCodeWithRev((row.itemCode ?? row.itemCodeText) as string | null, row.itemRevision),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (row) => row.itemName ?? row.itemNameText ?? '—',
      title: (row) => row.itemName ?? row.itemNameText ?? '',
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
        const badge = planBadge(row);
        return <span className={`badge ${badge.cls}`}>{badge.label}</span>;
      },
    },
  ];
}

/** One labelled fact in the ▸ reveal. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ minWidth: 120 }}>
      <div
        className="text3"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

/**
 * The ▸ reveal: the secondary facts kept off the row (POL, SO/JWSO, Ln, Order
 * Qty, Covered, PRO No., JC No., Dispatch date). PRO No. / JC No. are real
 * links; the rest are read-only.
 */
export function PlanExpanded({ row }: { row: PlanRow }): React.JSX.Element {
  const poStatus = row.productionOrderStatus
    ? ((PRODUCTION_ORDER_STATUS_LABEL as Record<string, string | undefined>)[
        row.productionOrderStatus
      ] ?? row.productionOrderStatus)
    : undefined;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '10px 14px' }}>
      <Field label="POL">
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {row.clientPoLineNo ?? '—'}
        </span>
      </Field>
      <Field label="SO / JWSO No.">
        <span className="mono">
          {row.soCodeText ? soNoWithInternal(row.soCodeText, row.soInternalNo) : '—'}
        </span>
      </Field>
      <Field label="Ln">{row.lineNo ?? '—'}</Field>
      <Field label="Order Qty">
        <span className="mono fw-700">{row.orderQty}</span>
      </Field>
      <Field label="Covered">
        <span className="mono">{row.derivedStatus ? row.coveredQty : '—'}</span>
      </Field>
      <Field label="PRO No.">
        {row.productionOrderId && row.productionOrderCode ? (
          <Link
            to="/production-orders/$id"
            params={{ id: row.productionOrderId }}
            className="td-code"
            title={poStatus ? `Production Order · ${poStatus}` : 'Production Order'}
          >
            {row.productionOrderCode}
          </Link>
        ) : (
          <span className="text3">—</span>
        )}
      </Field>
      <Field label="JC No.">
        {row.jcId && row.jcCode ? (
          <Link to="/job-cards/$id" params={{ id: row.jcId }} className="td-code">
            {row.jcCode}
          </Link>
        ) : (
          <span className="text3">—</span>
        )}
      </Field>
      <Field label="Dispatch date">
        {row.customerDispatchDate ? fmtDate(row.customerDispatchDate) : '—'}
      </Field>
    </div>
  );
}

/** `path?a=1&b=2`, leaving out the empty values. */
function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
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
  opts: { canCreateRouteCard: boolean; canProductionOrder: boolean },
): RowMenuItem[] {
  const itemLabel = (row.itemCode ?? row.itemCodeText) as string | null;
  const itemName = row.itemName ?? row.itemNameText;
  const newPoTo = withQuery('/production-orders/new', { planId: row.id, planCode: row.code });
  if (row.derivedStatus === 'route_card_pending') {
    return [
      {
        key: 'create-route-card',
        label: 'Create Route Card',
        icon: 'plus',
        group: 'workflow',
        hidden: !opts.canCreateRouteCard,
        to: withQuery('/route-cards/new', { itemId: row.itemId, itemCode: itemLabel, itemName }),
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
      // The Job Card: status, then Op Entry from there.
      key: 'op-entry',
      label: 'Op Entry',
      icon: 'play',
      group: 'workflow',
      hidden: !row.jcId,
      to: row.jcId ? `/job-cards/${row.jcId}` : undefined,
    },
    {
      key: 'close-po',
      label: 'Close Production Order',
      icon: 'lock',
      group: 'workflow',
      hidden: !opts.canProductionOrder,
      disabledReason: jcDone ? undefined : 'Job Card not complete',
      ...(jcDone
        ? { to: withQuery('/production-orders/close', { planId: row.id, planCode: row.code }) }
        : {}),
    },
  ];
}
