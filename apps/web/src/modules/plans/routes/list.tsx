// Plans list (PL-4). All plans with status + type + search filters. THE Innovic
// fit table (ADR-199, table standard 2026-10-01): one ruled sheet, Plan No.
// pinned first, every visible fact its own column, the secondary facts in the
// row's ▸ reveal, and the next-step actions in the row's ⋯. The columns, the
// row tint, the ▸ reveal and the ⋯ menu live in components/plans-list-columns.
//
// ADR-170 (Production Orders): the same list is Production → Master → Plans.
// An All | Pending dropdown in the filter bar (was two pills) — where Pending is
// the server's `poPending=true` (route-card-driven plans that still have no
// Production Order). The Status column shows the DERIVED status for those plans
// and the stored planStatus for old plans, exactly as before.

import {
  PLAN_EFFECTIVE_STATUSES,
  type PlanEffectiveStatus,
  type PlanStatus,
  type PlanType,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePlansList, usePlanningDashboard } from '../api';
import { NeedsPlanningTable } from '../components/needs-planning-table';
import {
  PlanExpanded,
  STATUS_BADGE,
  planRowMenu,
  planRowTint,
  plansListColumns,
  renderPlanLink,
} from '../components/plans-list-columns';
import { DERIVED_LABEL } from '../lib/derived-status';

const searchSchema = z.object({
  search: z.string().optional(),
  // ADR-185 — the status the row shows (stored for old plans, derived for
  // route-card plans); the KPI tiles count by the same word.
  status: z.enum(PLAN_EFFECTIVE_STATUSES).optional(),
  planType: z.enum(['manufacture', 'direct_purchase', 'full_outsource', 'assembly']).optional(),
  // 25 rows a page (ADR-201). Every filter change below rebuilds the search
  // without `page`, so it lands on page 1.
  page: pageSearchParam,
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

function PlansListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status, planType, page, needsPlanning, pending } = plansListRoute.useSearch();
  const gotoPage = useCallback(
    (p: number): void =>
      void navigate({ to: '/plans', search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  // Sort & Filter on the SERVER (ADR-200): only one page is loaded, so the
  // column filters must run over every plan. Every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.plansList, () => gotoPage(1));
  const { data, isLoading, isError, error } = usePlansList({
    search,
    status,
    planType,
    ...(pending ? { poPending: true } : {}),
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);
  // KPI counts for the status dropdown's option labels (folded in from the
  // Planning Dashboard; they used to be clickable tiles).
  const dash = usePlanningDashboard();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  // The ⋯ menu's next steps: each one is the action that moves the plan out of
  // the state it shows, offered only to someone allowed to take it.
  const canCreateRouteCard = effectiveFormPerms(eff, 'routecard_create').entry;
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;

  // The row's ▸ opens its detail reveal; a Set — many can be open.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns = useMemo(() => plansListColumns(), []);

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
  // drops the page so a narrower result never starts on an empty page.
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
    return (
      <PageState
        as="page"
        state="noaccess"
        message="You do not have permission to view Plans. Ask an admin."
      />
    );
  }

  const rows = data?.items ?? [];
  const filtered = Boolean(search || status || planType || pending || sf.filtering);

  return (
    // `page-fill` (ADR-202): the Plans list fills the content area so the
    // TABLE is the only thing that scrolls. The Needs-Planning mode's own table
    // now opts in with `fill` too, so both modes behave the same.
    <div className="page-fill">
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
              <option value="direct_purchase">🛒 Buy</option>
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
        onClearFilters={() => {
          sf.clearFilters();
          void navigate({ to: '/plans', search: {} });
        }}
        filtersActive={!!(search || status || planType || pending || needsPlanning || sf.filtering)}
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
      ) : isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load plans. Try again.'}
        />
      ) : (
        <>
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.plansList}
              columns={columns}
              rows={rows}
              loading={isLoading}
              sortFilterServer={sf}
              empty={filtered ? 'No Plans match.' : 'No Plans yet.'}
              rowClassName={(row) => planRowTint(row)}
              onRowClick={(row) => void navigate({ to: '/plans/$id', params: { id: row.id } })}
              // The fit table's ▸ is the row's one expand control: it opens the
              // plan's secondary facts. renderExpanded returns null for a
              // closed row.
              renderExpanded={(row) =>
                expandedIds.has(row.id) ? <PlanExpanded row={row} /> : null
              }
              onToggleExpanded={(row) => toggleExpand(row.id)}
              rowMenu={(row) => planRowMenu(row, { canCreateRouteCard, canProductionOrder })}
              renderLink={renderPlanLink}
            />
          </Panel>
          <ListFooter
            total={data?.total ?? 0}
            noun="plan"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
        </>
      )}
    </div>
  );
}
