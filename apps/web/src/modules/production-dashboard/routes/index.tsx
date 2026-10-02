// Production Dashboard (Production Wave 4). Ports legacy renderDashboard
// (HTML L3658): stat cards, Machine-wise Pending Work, Open Job Cards, Ready to
// Process Now, Supply Chain Snapshot.
//
// ADR-203 (frozen header, 2026-10-02): ONE table on screen at a time. The
// header + the 4-KPI StatStrip are fixed chrome, then a TabStrip
// "Available Now (n) | Open Job Cards (n) | Machine Pending (n) | Supply
// Snapshot" (active tab in the URL `tab`; default Available Now). The tab's
// table fills the rest of the screen (`page-fill` + `<Panel fill>`, ADR-202)
// and its column header never scrolls away:
//  - Available Now — the ADR-199 fit table (columns, ▸ detail, ⋯ menu and row
//    tint in ../components/ready-columns), 25 a page, server Sort & Filter.
//    Legacy hid it when empty; as a tab it shows (0) and an empty state.
//  - Open Job Cards — the former card grid as one table, same endpoint and
//    25-row paging (../components/open-jc-columns).
//  - Machine Pending — the former machine cards as one table with a group
//    heading per machine (../components/machine-pending-panel).
//  - Supply Snapshot — 4 tiles + the Below Reorder list as a table.
// Each tab keeps its own page number, so switching tabs never loses it.
//
// Data reuse (no figure is recomputed in React — CLAUDE.md rule 1):
//  - "Machine Pending" reads GET /machine-loading via useMachineLoading(); ops
//    are grouped by machine for display only.
//  - "Supply Snapshot" reads supplyChain on GET /production-dashboard.

import { createRoute, Link } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation/TabStrip';
import { renderJcOpsLink } from '@/modules/jc-ops/components/jc-ops-columns';
import { useMachineLoading } from '@/modules/machine-loading/api';
import {
  countBusyMachines,
  groupPendingOps,
  MachinePendingPanel,
} from '../components/machine-pending-panel';
import { OpenJcRowMenu, openJcColumns } from '../components/open-jc-columns';
import {
  PROD_READY_DEFAULT_HIDDEN,
  PROD_READY_DEFAULT_PINNED,
  prodReadyColumns,
  prodReadyRowMenu,
  prodReadyRowTint,
} from '../components/ready-columns';
import { SupplyChainPanel } from '../components/supply-chain-panel';
import { useOpenJobCards, useProductionDashboard, useReadyOps } from '../api';

const TABS = ['ready', 'jcs', 'machines', 'supply'] as const;
type Tab = (typeof TABS)[number];

const searchSchema = z.object({
  /** Active tab; absent = Available Now. */
  tab: z.enum(TABS).optional(),
});

export const productionDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-dashboard',
  validateSearch: searchSchema,
  component: ProductionDashboardPage,
});

const READY_COLUMNS = prodReadyColumns();
const JC_COLUMNS = openJcColumns();

function ProductionDashboardPage(): React.JSX.Element {
  const search = productionDashboardRoute.useSearch();
  const navigate = productionDashboardRoute.useNavigate();
  const tab: Tab = search.tab ?? 'ready';
  const setTab = (k: string): void => {
    const next = TABS.find((t) => t === k);
    void navigate({
      search: (prev) => ({ ...prev, tab: next === 'ready' ? undefined : next }),
      replace: true,
    });
  };

  const { data, isLoading, isFetching, isError, error } = useProductionDashboard();
  const machine = useMachineLoading();
  const c = data?.counters;
  const supplyChain = data?.supplyChain;
  // Open Job Cards — 25 a page (own page number, kept across tab switches).
  const [jcPage, setJcPage] = useState(1);
  const onJcPage = useCallback((p: number) => setJcPage(p), []);
  const jcs = useOpenJobCards({ limit: LIST_PAGE_SIZE, offset: pageOffset(jcPage) });
  useClampPage(jcPage, jcs.data?.total, onJcPage);
  const openJobCards = jcs.data?.items ?? [];
  // Available Now — 25 ops a page, server Sort & Filter (any change → page 1).
  const [readyPage, setReadyPage] = useState(1);
  const onReadyPage = useCallback((p: number) => setReadyPage(p), []);
  const readySf = useServerSortFilter(TABLE_KEYS.prodDashboardReady, () => setReadyPage(1));
  const ready = useReadyOps({
    sf: readySf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(readyPage),
  });
  useClampPage(readyPage, ready.data?.total, onReadyPage);
  const readyToProcess = ready.data?.items ?? [];
  const readyTotal = ready.data?.total ?? 0;
  // ▶ Start / ✚ Log on the Ready rows and the Open JC ⋯ Op Entry open Op
  // Entry — the same gate the Job Queue uses for the same links.
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;

  // Grouped ONCE per machine-loading response: the tab count and the panel
  // both read this result.
  const machineCount = machine.data?.machines.length ?? 0;
  const machineGroups = useMemo(
    () => groupPendingOps(machine.data?.machines ?? [], machine.data?.ops ?? []),
    [machine.data],
  );

  return (
    <div className="page-fill">
      <ListHeader title="Production Dashboard" icon="📊" updating={isFetching && !isLoading} />

      {isLoading ? (
        <PageState state="loading" message="Loading dashboard…" />
      ) : isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load dashboard. Try again.'}
        />
      ) : (
        <>
          {/* Stat cards — legacy L3756-3777. ONE StatStrip row. */}
          <div style={{ marginBottom: 'var(--panel-gap)' }}>
            <StatStrip
              items={[
                {
                  key: 'open-jc',
                  label: 'Open Job Cards',
                  count: c?.openJc ?? 0,
                  color: 'var(--cyan)',
                  sub: `${c?.totalJc ?? 0} total · ${c?.noOpsJc ?? 0} without operations`,
                },
                {
                  key: 'pending',
                  label: 'Pending Qty (pcs)',
                  count: c?.pendingQty ?? 0,
                  color: 'var(--amber)',
                },
                {
                  key: 'running',
                  label: 'Running',
                  count: c?.runningOps ?? 0,
                  color: (c?.runningOps ?? 0) > 0 ? 'var(--green)' : 'var(--text3)',
                },
                {
                  key: 'available',
                  label: 'Available (pcs)',
                  count: c?.readyQty ?? 0,
                  color: 'var(--green)',
                },
              ]}
            />
          </div>

          <TabStrip
            label="Production Dashboard views"
            activeKey={tab}
            onChange={setTab}
            tabs={[
              // Server's full-scope count (every ready op, not the page).
              { key: 'ready', label: 'Available Now', count: c?.readyOps ?? null },
              { key: 'jcs', label: 'Open Job Cards', count: jcs.data?.total ?? null },
              {
                key: 'machines',
                label: 'Machine Pending',
                count: machine.data ? countBusyMachines(machineGroups.rows) : null,
              },
              { key: 'supply', label: 'Supply Snapshot' },
            ]}
          />

          {tab === 'ready' ? (
            <>
              <Panel fill bodyPadding="none">
                <DataTable
                  tableKey={TABLE_KEYS.prodDashboardReady}
                  columns={READY_COLUMNS}
                  rows={readyToProcess}
                  rowKey={(op) => op.jcOpId}
                  sortFilterServer={readySf}
                  loading={ready.isLoading}
                  emptyText={
                    readySf.filtering ? 'No operations match.' : 'No operations available now.'
                  }
                  defaultPinned={PROD_READY_DEFAULT_PINNED}
                  defaultHidden={PROD_READY_DEFAULT_HIDDEN}
                  rowClassName={prodReadyRowTint}
                  rowMenu={(op) => prodReadyRowMenu(op, canOpEntry)}
                  renderLink={renderJcOpsLink}
                />
              </Panel>
              <ListFooter
                total={readyTotal}
                noun="operation"
                page={readyPage}
                pageSize={LIST_PAGE_SIZE}
                onPage={onReadyPage}
              />
            </>
          ) : tab === 'jcs' ? (
            <>
              <Panel
                fill
                bodyPadding="none"
                actions={
                  <Link to="/job-cards" className="btn btn-ghost btn-sm">
                    All JCs →
                  </Link>
                }
              >
                <DataTable
                  tableKey={TABLE_KEYS.prodDashboardOpenJcs}
                  columns={JC_COLUMNS}
                  rows={openJobCards}
                  rowKey={(jc) => jc.jobCardId}
                  loading={jcs.isLoading}
                  emptyText="No open Job Cards."
                  onRowClick={(jc) =>
                    void navigate({ to: '/job-cards/$id', params: { id: jc.jobCardId } })
                  }
                  rowActionsWidth="1%"
                  rowActions={(jc) => <OpenJcRowMenu jc={jc} canOpEntry={canOpEntry} />}
                />
              </Panel>
              <ListFooter
                total={jcs.data?.total ?? 0}
                noun="open job card"
                page={jcPage}
                pageSize={LIST_PAGE_SIZE}
                onPage={onJcPage}
              />
            </>
          ) : tab === 'machines' ? (
            <MachinePendingPanel
              grouped={machineGroups}
              machineCount={machineCount}
              isLoading={machine.isLoading}
            />
          ) : (
            <SupplyChainPanel data={supplyChain} />
          )}
        </>
      )}
    </div>
  );
}
