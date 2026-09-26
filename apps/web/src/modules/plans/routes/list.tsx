// Plans list (PL-4). All plans with status + type + search filters + pagination.
//
// ADR-170 (Production Orders): the same list is Production → Master → Plans.
// An All | Pending dropdown in the filter bar (was two pills) — where Pending is the server's
// `poPending=true` (route-card-driven plans that still have no Production
// Order). The Status column shows the DERIVED status for those plans
// (Route card pending → Gen production order → In production → Production
// complete) and the stored planStatus for old plans, exactly as before.

import {
  PLAN_EFFECTIVE_STATUSES,
  type ListPlansResponse,
  type PlanEffectiveStatus,
  type PlanStatus,
  type PlanType,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePlansList, usePlanningDashboard } from '../api';
import { NeedsPlanningTable } from '../components/needs-planning-table';
import { DERIVED_BADGE, DERIVED_LABEL } from '../lib/derived-status';

const searchSchema = z.object({
  search: z.string().optional(),
  // ADR-185 — the status the row shows (stored for old plans, derived for
  // route-card plans); the KPI tiles count by the same word.
  status: z.enum(PLAN_EFFECTIVE_STATUSES).optional(),
  planType: z.enum(['manufacture', 'direct_purchase', 'full_outsource', 'assembly']).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  // Needs-Planning mode — folded in from the retired Planning Dashboard; swaps
  // the plans table for the unplanned-SO-lines table.
  needsPlanning: z.boolean().optional(),
  // ADR-170 — the "Pending" pill: route-card-driven plans with no Production
  // Order yet. Absent = "All". Narrows WITHIN status / type / search.
  pending: z.boolean().optional(),
});

export const plansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans',
  validateSearch: searchSchema,
  component: PlansListPage,
});

const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: 'b-grey', label: 'In Planning' },
  planned: { cls: 'b-blue', label: 'Planned' },
  jc_created: { cls: 'b-cyan', label: 'JC Created' },
  pr_created: { cls: 'b-cyan', label: 'PR Created' },
  in_production: { cls: 'b-amber', label: 'In Production' },
  complete: { cls: 'b-green', label: 'Completed' },
  cancelled: { cls: 'b-grey', label: 'Cancelled' },
};

const TYPE_LABEL: Record<PlanType, string> = {
  manufacture: 'Manufacture',
  direct_purchase: 'Direct Purchase',
  full_outsource: 'Full Outsource',
  assembly: 'Assembly',
};

const TYPE_ICON: Record<PlanType, string> = {
  manufacture: '🏭',
  direct_purchase: '🛒',
  full_outsource: '📦',
  assembly: '🔧',
};

// Status dropdown value for the Needs-Planning mode (the `needsPlanning` URL
// flag, not a plan status).
const NEEDS_PLANNING = '__needs_planning';

// Status → the planning-dashboard KPI key that counts it (same keys the old
// tiles read). Cancelled has no tile, so no count.
const STATUS_KPI_KEY: Record<
  PlanStatus | 'route_card_pending' | 'gen_production_order',
  string | undefined
> = {
  in_planning: 'inPlanning',
  planned: 'planned',
  jc_created: 'jcCreated',
  pr_created: 'prCreated',
  in_production: 'inProduction',
  complete: 'complete',
  cancelled: undefined,
  route_card_pending: 'rcPending',
  gen_production_order: 'rcCreated',
};

// One fetch, then scroll — no Prev / Next (user, 2026-09-19). The list-query
// cap is 500; the count line under the table flags a rarer larger set.
const LIMIT = 500;

function PlansListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status, planType, offset, needsPlanning, pending } = plansListRoute.useSearch();
  const off = offset ?? 0;
  const { data, isLoading, isError, error } = usePlansList({
    search,
    status,
    planType,
    ...(pending ? { poPending: true } : {}),
    limit: LIMIT,
    offset: off,
  });
  // KPI counts for the status dropdown's option labels (folded in from the
  // Planning Dashboard; they used to be clickable tiles).
  const dash = usePlanningDashboard();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');

  // Status dropdown → URL filter. A status sets `status`; "Needs Planning"
  // flips the body to the unplanned-SO-lines table. Each clears the other so
  // only one mode is ever active.
  const selectNeedsPlanning = (): void =>
    void navigate({
      to: '/plans',
      search: {
        ...(search ? { search } : {}),
        ...(planType ? { planType } : {}),
        ...(pending ? { pending } : {}),
        ...(needsPlanning ? {} : { needsPlanning: true }),
      },
    });
  // All | Pending dropdown (was pills). Same URL-param shape as the SO list's status pills;
  // drops the offset so a narrower result never starts on an empty page.
  const selectPending = (p: boolean): void =>
    void navigate({
      to: '/plans',
      search: {
        ...(search ? { search } : {}),
        ...(planType ? { planType } : {}),
        ...(status ? { status } : {}),
        ...(p ? { pending: true } : {}),
      },
      replace: true,
    });

  // "In Planning (12)" — the count the old tile showed; bare label while the
  // dashboard loads or for a status that has no tile.
  const kpi: Record<string, number> = dash.data?.kpi ?? {};
  const withCount = (label: string, kpiKey: string | undefined): string => {
    const n = kpiKey ? kpi[kpiKey] : undefined;
    return n == null ? label : `${label} (${n})`;
  };

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The ONE list header (ui/layout ListHeader). Same URL params and the
          same server search / status / type filters as before. The filter bar
          carries status (with the old KPI-tile counts), type and All |
          Pending (ADR-170) as dropdowns — no tiles, no pills. */}
      <ListHeader
        title="Plans"
        icon="📋"
        count={needsPlanning ? undefined : data?.total}
        noun="plan"
        filterNote={pending ? 'Pending' : undefined}
        search={search ?? ''}
        onSearch={(v) =>
          void navigate({
            to: '/plans',
            search: {
              ...(status ? { status } : {}),
              ...(planType ? { planType } : {}),
              ...(pending ? { pending } : {}),
              search: v || undefined,
            },
          })
        }
        searchPlaceholder="Search plan no., item code / name, SO no., POL, Production Order, JC…"
        filters={
          <>
            {/* Status — the former KPI tiles, folded in: every option carries
                the same count its tile showed, and "Needs Planning" still
                swaps the body for the unplanned-SO-lines table. */}
            <select
              className="innovic-select"
              aria-label="Plan status"
              title="Plan status"
              value={needsPlanning ? NEEDS_PLANNING : (status ?? '')}
              onChange={(e) => {
                const v = e.target.value;
                if (v === NEEDS_PLANNING) {
                  if (!needsPlanning) selectNeedsPlanning();
                  return;
                }
                void navigate({
                  to: '/plans',
                  search: {
                    ...(search ? { search } : {}),
                    ...(planType ? { planType } : {}),
                    ...(pending ? { pending } : {}),
                    status: (v as PlanEffectiveStatus | '') || undefined,
                  },
                });
              }}
            >
              <option value="">All statuses</option>
              <option value={NEEDS_PLANNING}>{withCount('Needs Planning', 'needsPlanning')}</option>
              {(Object.keys(STATUS_BADGE) as PlanStatus[]).map((s) => (
                <option key={s} value={s}>
                  {withCount(STATUS_BADGE[s].label, STATUS_KPI_KEY[s])}
                </option>
              ))}
              {/* ADR-185 — the two route-card states with no stored twin. */}
              <option value="route_card_pending">
                {withCount(DERIVED_LABEL.route_card_pending, STATUS_KPI_KEY.route_card_pending)}
              </option>
              <option value="gen_production_order">
                {withCount(DERIVED_LABEL.gen_production_order, STATUS_KPI_KEY.gen_production_order)}
              </option>
            </select>
            <select
              className="innovic-select"
              aria-label="Plan type"
              title="Plan type"
              value={planType ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/plans',
                  search: {
                    ...(search ? { search } : {}),
                    ...(status ? { status } : {}),
                    ...(pending ? { pending } : {}),
                    planType: (e.target.value as PlanType | '') || undefined,
                  },
                })
              }
            >
              <option value="">All types</option>
              <option value="manufacture">🏭 Manufacture</option>
              <option value="direct_purchase">🛒 Direct Purchase</option>
              <option value="full_outsource">📦 Full Outsource</option>
              <option value="assembly">🔧 Assembly</option>
            </select>
            {/* ADR-170 — All | Pending. "Pending" = route-card-driven plans
                that still need a Production Order (server filter `poPending`).
                Old plans only ever appear under All. */}
            <select
              className="innovic-select"
              aria-label="Plans waiting for a Production Order"
              title="Plans waiting for a Production Order"
              value={pending ? 'pending' : ''}
              onChange={(e) => selectPending(e.target.value === 'pending')}
            >
              <option value="">All plans</option>
              <option value="pending">Pending</option>
            </select>
          </>
        }
        onClearFilters={() => void navigate({ to: '/plans', search: {} })}
        filtersActive={!!(search || status || planType || pending || needsPlanning)}
        primary={
          perms.entry ? (
            <Link to="/plans/new" className="btn btn-primary">
              <Plus size={13} /> New Plan
            </Link>
          ) : null
        }
      />

      {needsPlanning ? (
        <NeedsPlanningTable />
      ) : isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load plans. Try again.'}
            </div>
          </div>
        </div>
      ) : data ? (
        <Table data={data} />
      ) : null}
    </div>
  );
}

function Table({ data }: { data: ListPlansResponse }): React.JSX.Element {
  // The Status column's next-step buttons: each one is the action that moves
  // the plan out of the state it shows, offered only to someone allowed to
  // take it.
  const { data: eff } = useMyAccess();
  const canCreateRouteCard = effectiveFormPerms(eff, 'routecard_create').entry;
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;
  if (data.items.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            No plans match the filter.
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="panel">
        {/* The sheet look (tbl-grid) the user supplied for this screen: bold
            blue column names, gridlines, cream / white rows, fixed widths that
            add up to the page so nothing scrolls sideways. Plan # carries its
            date and type underneath; Ops is gone; Status states where the plan
            IS and Action holds the one button that moves it on. */}
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            {/* Widths total exactly 100. POL took 5% — one each off Plan No.,
                SO and Action, two off Item — when it was added (2026-09-23). */}
            <colgroup>
              <col style={{ width: '11%' }} />
              <col style={{ width: '5%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Plan No.</th>
                {/* POL — the CUSTOMER's own PO line number, not our SO line
                    number (that stays in the SO column as "Ln"). */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code</th>
                <th>SO No.</th>
                <th className="th-num">Order Qty</th>
                <th className="th-num">Plan Qty</th>
                <th>Production Order No.</th>
                <th>JC No.</th>
                <th>Plan Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                // New-flow plans (opsSource 'route_card') carry a derived
                // status; old plans carry null and keep their stored label.
                const badge = row.derivedStatus
                  ? {
                      cls: DERIVED_BADGE[row.derivedStatus],
                      label: DERIVED_LABEL[row.derivedStatus],
                    }
                  : STATUS_BADGE[row.planStatus];
                const itemLabel = (row.itemCode ?? row.itemCodeText) as string | null;
                const itemName = row.itemName ?? row.itemNameText;
                return (
                  <tr key={row.id}>
                    <td>
                      <Link
                        to="/plans/$id"
                        params={{ id: row.id }}
                        className="td-code"
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {row.code}
                      </Link>
                      <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                        {fmtDate(row.planDate)}
                      </div>
                      <div className="text3" style={{ fontSize: 11 }}>
                        {TYPE_ICON[row.planType]} {TYPE_LABEL[row.planType]}
                      </div>
                      {row.customerDispatchDate ? (
                        <div className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          Dispatch {fmtDate(row.customerDispatchDate)}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {row.clientPoLineNo ?? '—'}
                    </td>
                    <td>
                      {/* `CODE/REV` — the customer's drawing revision from the
                          SO line this plan was raised against; a JW-sourced or
                          ad-hoc plan keeps the bare code. Item code bold: the
                          primary value on every screen. */}
                      <div className="mono fw-700" style={{ whiteSpace: 'nowrap' }}>
                        {itemCodeWithRev(itemLabel, row.itemRevision)}
                      </div>
                      {itemName ? (
                        <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                          {itemName}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {row.soCodeText ?? '—'}
                        {row.lineNo ? ` · Ln ${row.lineNo}` : ''}
                      </span>
                    </td>
                    <td className="mono fw-700 td-num">{row.orderQty}</td>
                    {/* ADR-182 — Plan Qty, and under it how much of it the
                        plan's Production Orders already cover. `Pending` is
                        what a new order may still be raised for (NAMING.md —
                        never "Remaining" or "Balance"). Only route-card plans
                        carry orders, so only they show the two lines. */}
                    <td className="mono fw-700 td-num">
                      {row.planQty}
                      {row.derivedStatus ? (
                        <div className="text3" style={{ fontSize: 11, fontWeight: 400 }}>
                          Covered {row.coveredQty}
                          <br />
                          Pending{' '}
                          <span
                            className="fw-700"
                            style={{
                              color: row.pendingQty > 0 ? 'var(--amber)' : 'var(--green)',
                            }}
                          >
                            {row.pendingQty}
                          </span>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {row.productionOrderId && row.productionOrderCode ? (
                        <Link
                          to="/production-orders/$id"
                          params={{ id: row.productionOrderId }}
                          className="td-code"
                          style={{ whiteSpace: 'nowrap' }}
                          title={
                            row.productionOrderStatus
                              ? `Production Order · ${row.productionOrderStatus}`
                              : 'Production Order'
                          }
                        >
                          {row.productionOrderCode}
                        </Link>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                    <td>
                      {row.jcId && row.jcCode ? (
                        <Link
                          to="/job-cards/$id"
                          params={{ id: row.jcId }}
                          className="td-code"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {row.jcCode}
                        </Link>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td>
                      {/* The one action that moves the plan out of the state
                          it shows — offered only to someone allowed to take
                          it. In production the Job Card comes first (status,
                          then Op Entry from there); closing the order is the
                          later step and sits second. */}
                      {row.derivedStatus === 'route_card_pending' && canCreateRouteCard ? (
                        <Link
                          to="/route-cards/new"
                          search={{
                            ...(row.itemId ? { itemId: row.itemId } : {}),
                            ...(itemLabel ? { itemCode: itemLabel } : {}),
                            ...(itemName ? { itemName } : {}),
                          }}
                          className="btn btn-sm btn-primary"
                          title="Create the route card for this item, then come back to raise the Production Order"
                        >
                          + Create Route Card
                        </Link>
                      ) : row.derivedStatus === 'gen_production_order' && canProductionOrder ? (
                        <Link
                          to="/production-orders/new"
                          search={{ planId: row.id, planCode: row.code }}
                          className="btn btn-sm btn-primary"
                          title="Raise the Production Order for this plan"
                        >
                          + Create Production Order
                        </Link>
                      ) : row.derivedStatus === 'in_production' ? (
                        <>
                          {/* ADR-182 — a plan part-covered by earlier orders
                              still needs one for its Pending qty, so the
                              action stays offered alongside Op Entry. */}
                          {canProductionOrder && row.pendingQty > 0 ? (
                            <Link
                              to="/production-orders/new"
                              search={{ planId: row.id, planCode: row.code }}
                              className="btn btn-sm btn-primary"
                              title={`Raise a Production Order for the ${row.pendingQty} still Pending on this plan`}
                            >
                              + Create Production Order
                            </Link>
                          ) : null}
                          {row.jcId ? (
                            <Link
                              to="/job-cards/$id"
                              params={{ id: row.jcId }}
                              className="btn btn-sm btn-primary"
                              title={`Open Job Card ${row.jcCode ?? ''} — status and Op Entry`}
                            >
                              ▶ Op Entry
                            </Link>
                          ) : null}
                          {/* Close is offered only once the Job Card has
                              actually finished — before that the server
                              would refuse it, so the button would only be a
                              way to meet an error. */}
                          {canProductionOrder &&
                          (row.jcStatus === 'complete' || row.jcStatus === 'closed') ? (
                            <Link
                              to="/production-orders/close"
                              search={{ planId: row.id, planCode: row.code }}
                              className="btn btn-sm"
                              title="Close this plan's Production Order — its Job Card is complete"
                            >
                              🔒 Close
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ListFooter total={data.total} shown={data.items.length} noun="plan" limit={LIMIT} />
    </>
  );
}
