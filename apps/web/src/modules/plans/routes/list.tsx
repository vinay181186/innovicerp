// Plans list (PL-4). All plans with status + type + search filters.
//
// ADR-170 (Production Orders): the same list is Production → Master → Plans.
// Two pills above the table — All | Pending — where Pending is the server's
// `poPending=true` (route-card-driven plans that still have no Production
// Order). The Status column shows the DERIVED status for those plans
// (Route card pending → Gen production order → In production → Production
// complete) and the stored planStatus for old plans, exactly as before.
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx):
//
//   <ListHeader>            title · count · SearchInput · status + type filters · + New plan
//     <StatusPills>         All | Pending (ADR-170)
//     <PlanningKpiStrip>    the KPI counts — now a StatStrip, tile-as-filter
//   </ListHeader>
//   <NeedsPlanningTable>    OR
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line
//   <PageState>             no-access and load-failure
//
// Gone from this file: the Tailwind utility classes on the header row, the
// bare <input> and two <select>s, the hand-rolled pill buttons, the
// <table>/<colgroup>/<thead>, the panel-wrapped loading / error / empty
// blocks and the count line. What stays is the DATA and the RULES: the five
// URL filters and the exact navigate() shapes that write them, the two extra
// permission reads behind the Action column, and the derived-vs-stored status
// split.
//
// What did NOT change: the route and its search params, the search box still
// writing the URL on every keystroke (this list has never debounced), the
// three navigate() helpers and which params each one drops, the Action
// column's four cases and their gates, and the Needs-Planning mode.

import type { ListPlansResponse, PlanStatus, PlanType } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, StatusPills } from '@/ui/layout';
import { usePlansList, usePlanningDashboard } from '../api';
import { PlanningKpiStrip } from '../components/planning-kpi-strip';
import { NeedsPlanningTable } from '../components/needs-planning-table';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z
    .enum([
      'in_planning',
      'planned',
      'jc_created',
      'pr_created',
      'in_production',
      'complete',
      'cancelled',
    ])
    .optional(),
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

// The plan-status words the filter offers. The COLOURS live in
// ui/core/StatusBadge.tsx under kind="plan" — one map, shared with the plan
// detail page, so the two screens cannot paint the same status differently.
const STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Complete',
  cancelled: 'Cancelled',
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

/** One row of the plans list. The response schema does not export the item
 *  type on its own, so it is read off the response here. */
type PlanRow = ListPlansResponse['items'][number];

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
  // KPI counts for the filter-bar tiles (folded in from the Planning Dashboard).
  const dash = usePlanningDashboard();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');

  // Tile → URL filter. Status tiles set `status`; the Needs Planning tile flips
  // the body to the unplanned-SO-lines table. Both clear the other so only one
  // mode is ever active. Each helper REBUILDS the search object rather than
  // spreading the old one — that is what drops `offset`, so a narrower result
  // never starts on an empty page.
  const selectStatus = (s: PlanStatus | undefined): void =>
    void navigate({
      to: '/plans',
      search: {
        ...(search ? { search } : {}),
        ...(planType ? { planType } : {}),
        ...(pending ? { pending } : {}),
        ...(s ? { status: s } : {}),
      },
    });
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
  // All | Pending pills. Same URL-param shape as the SO list's status pills.
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

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      <ListHeader
        title="Plans"
        icon="📋"
        count={data?.total}
        noun="plan"
        search={search ?? ''}
        searchPlaceholder="Search plan, item, SO, PO, JC…"
        // No debounce: this list has always written the term straight into the
        // URL on every keystroke, and that is the behaviour being preserved.
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
        tools={
          <>
            <Select
              aria-label="Filter by plan status"
              fieldWidth="md"
              value={status ?? ''}
              onChange={(e) =>
                void navigate({
                  to: '/plans',
                  search: {
                    ...(search ? { search } : {}),
                    ...(planType ? { planType } : {}),
                    ...(pending ? { pending } : {}),
                    status: (e.target.value as PlanStatus | '') || undefined,
                  },
                })
              }
              options={[
                { value: '', label: 'All statuses' },
                ...(Object.keys(STATUS_LABEL) as PlanStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_LABEL[s],
                })),
              ]}
            />
            <Select
              aria-label="Filter by plan type"
              fieldWidth="md"
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
              options={[
                { value: '', label: 'All types' },
                ...(Object.keys(TYPE_LABEL) as PlanType[]).map((t) => ({
                  value: t,
                  label: `${TYPE_ICON[t]} ${TYPE_LABEL[t]}`,
                })),
              ]}
            />
          </>
        }
        primary={
          perms.entry ? (
            <Link to="/plans/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New plan
            </Link>
          ) : null
        }
      >
        {/* Two rows share the band's children slot, so they carry their own
            gap — the slot itself stacks them flush. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          {/* ADR-170 — All | Pending. "Pending" = route-card-driven plans that
              still need a Production Order (server filter `poPending`). Old
              plans only ever appear under All. */}
          <StatusPills
            options={[{ value: 'pending', label: 'Pending' }]}
            value={pending ? 'pending' : null}
            label="Filter by Production Order state"
            onChange={(v) => selectPending(v === 'pending')}
          />
          <PlanningKpiStrip
            kpi={dash.data?.kpi ?? {}}
            activeStatus={status}
            needsPlanning={!!needsPlanning}
            onSelectStatus={selectStatus}
            onSelectNeedsPlanning={selectNeedsPlanning}
          />
        </div>
      </ListHeader>

      {needsPlanning ? (
        <NeedsPlanningTable />
      ) : isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Failed to load plans'}
        />
      ) : (
        <PlansTable data={data} loading={isLoading} />
      )}
    </div>
  );
}

function PlansTable({
  data,
  loading,
}: {
  data: ListPlansResponse | undefined;
  loading: boolean;
}): React.JSX.Element {
  // The Action column's next-step buttons: each one is the action that moves
  // the plan out of the state it shows, offered only to someone allowed to
  // take it.
  const { data: eff } = useMyAccess();
  const canCreateRouteCard = effectiveFormPerms(eff, 'routecard_create').entry;
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  // Widths are `%` and must sum to 100 WITH the Action column
  // (rowActionsWidth below): 11+5+17+10+6+6+11+11+10 = 87, + 13 = 100. POL
  // took 5% — one each off Plan No., SO and Action, two off Item — when it was
  // added (2026-09-23).
  const columns = useMemo<DataTableColumn<PlanRow>[]>(
    () => [
      {
        header: 'Plan No.',
        width: '11%',
        align: 'left',
        // Plan No. carries its date and type underneath, so the cell is three
        // quiet lines under one strong code.
        render: (row) => (
          <>
            <Link
              to="/plans/$id"
              params={{ id: row.id }}
              className="td-code"
              style={{ whiteSpace: 'nowrap' }}
            >
              {row.code}
            </Link>
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              {row.planDate}
            </div>
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              {TYPE_ICON[row.planType]} {TYPE_LABEL[row.planType]}
            </div>
            {row.customerDispatchDate ? (
              <div className="text3" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                Dispatch {row.customerDispatchDate}
              </div>
            ) : null}
          </>
        ),
      },
      {
        // POL — the CUSTOMER's own PO line number, not our SO line number
        // (that stays in the SO column as "L#").
        header: 'POL',
        width: '5%',
        className: 'mono fw-700',
        headColor: 'var(--purple)',
        nowrap: true,
        render: (row) => (
          <span style={{ color: 'var(--purple)' }}>{row.clientPoLineNo ?? '—'}</span>
        ),
      },
      {
        header: 'Item',
        width: '17%',
        align: 'left',
        // `CODE/REV` — the customer's drawing revision from the SO line this
        // plan was raised against; a JW-sourced or ad-hoc plan keeps the bare
        // code. Item code bold: the primary value on every screen.
        render: (row) => {
          const itemLabel = (row.itemCode ?? row.itemCodeText) as string | null;
          const itemName = row.itemName ?? row.itemNameText;
          return (
            <>
              <div className="mono fw-700" style={{ whiteSpace: 'nowrap' }}>
                {itemCodeWithRev(itemLabel, row.itemRevision)}
              </div>
              {itemName ? (
                <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                  {itemName}
                </div>
              ) : null}
            </>
          );
        },
      },
      {
        header: 'SO No.',
        width: '10%',
        className: 'mono',
        nowrap: true,
        render: (row) => `${row.soCodeText ?? '—'}${row.lineNo ? ` · L#${row.lineNo}` : ''}`,
      },
      { header: 'Order Qty', width: '6%', className: 'mono fw-700', nowrap: true, key: 'orderQty' },
      { header: 'Plan Qty', width: '6%', className: 'mono fw-700', nowrap: true, key: 'planQty' },
      {
        header: 'Production Order No',
        width: '11%',
        nowrap: true,
        render: (row) =>
          row.productionOrderId && row.productionOrderCode ? (
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
          ),
      },
      {
        header: 'JC No.',
        width: '11%',
        nowrap: true,
        render: (row) =>
          row.jcId && row.jcCode ? (
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
          ),
      },
      {
        header: 'Plan Status',
        width: '10%',
        nowrap: true,
        // New-flow plans (opsSource 'route_card') carry a DERIVED status; old
        // plans carry null and keep their stored one. The two are different
        // colour maps — `in_production` is amber as a stored status and cyan as
        // a derived one — so they are two kinds, not one (ui/core/StatusBadge).
        render: (row) =>
          row.derivedStatus ? (
            <StatusBadge kind="planderived" status={row.derivedStatus} />
          ) : (
            <StatusBadge kind="plan" status={row.planStatus} label={STATUS_LABEL[row.planStatus]} />
          ),
      },
    ],
    [],
  );

  return (
    <>
      <Panel bodyPadding="none">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          empty={
            <>
              <div className="empty-icon">📋</div>
              No plans match the filter.
            </>
          }
          rowActionsWidth="13%"
          // The one action that moves the plan out of the state it shows —
          // offered only to someone allowed to take it. In production the Job
          // Card comes first (status, then Op Entry from there); closing the
          // order is the later step and sits second.
          //
          // NOT <RowActions>: this column holds a workflow step, not the
          // View / Edit / Delete cluster. A plan is opened from its Plan No.
          rowActions={(row) => {
            const itemLabel = (row.itemCode ?? row.itemCodeText) as string | null;
            const itemName = row.itemName ?? row.itemNameText;
            if (row.derivedStatus === 'route_card_pending' && canCreateRouteCard) {
              return (
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
              );
            }
            if (row.derivedStatus === 'gen_production_order' && canProductionOrder) {
              return (
                <Link
                  to="/production-orders/new"
                  search={{ planId: row.id, planCode: row.code }}
                  className="btn btn-sm btn-primary"
                  title="Raise the Production Order for this plan"
                >
                  + Create Production Order
                </Link>
              );
            }
            if (row.derivedStatus === 'in_production') {
              return (
                <>
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
                  {/* Close is offered only once the Job Card has actually
                      finished — before that the server would refuse it, so the
                      button would only be a way to meet an error. */}
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
              );
            }
            return <span className="text3">—</span>;
          }}
        />
      </Panel>

      <ListFooter total={total} shown={rows.length} noun="plan" limit={LIMIT} />
    </>
  );
}
