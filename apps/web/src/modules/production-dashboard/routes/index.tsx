// Production Dashboard (Production Wave 4). Ports legacy renderDashboard
// (HTML L3658), all 4 panels in legacy's order: stat cards → Machine-wise
// Pending Work → Open Job Cards → Ready to Process Now → Supply Chain Snapshot.
// Legacy chrome.
//
// ADR-199 (table standard): the ONE main list — "Available Now" (Ready to
// process) — is the shared fit table (DataTable + tableKey); its columns, ▸
// detail, ⋯ menu and row tint live in ../components/ready-columns. The other
// panels (Machine-wise Pending Work, Open Job Cards, Supply Chain Snapshot) stay
// look-only WIDGETS per ADR-199 ("widgets are look-only exceptions") and live in
// their own files under ../components. This route was split (was 774 lines) to
// stay under the file-size rule.
//
// ADR-201 (2026-10-02): Open Job Cards and Available Now page at 25 from the
// server (own endpoints, page in component state, Prev / Next); Available Now
// sorts / filters on the server (▾). Counts are the server's full-scope ones.
//
// Data reuse (no figure is recomputed in React — CLAUDE.md rule 1):
//  - "Machine-wise Pending Work" reads GET /machine-loading via
//    useMachineLoading(); ops are grouped by machine for display only.
//  - "Supply Chain Snapshot" reads supplyChain on GET /production-dashboard.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { renderJcOpsLink } from '@/modules/jc-ops/components/jc-ops-columns';
import { useMachineLoading } from '@/modules/machine-loading/api';
import { JcCard } from '../components/jc-card';
import { MachinePendingPanel } from '../components/machine-pending-panel';
import {
  PROD_READY_DEFAULT_HIDDEN,
  PROD_READY_DEFAULT_PINNED,
  prodReadyColumns,
  prodReadyRowMenu,
  prodReadyRowTint,
} from '../components/ready-columns';
import { SupplyChainPanel } from '../components/supply-chain-panel';
import { useOpenJobCards, useProductionDashboard, useReadyOps } from '../api';

export const productionDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-dashboard',
  component: ProductionDashboardPage,
});

function ProductionDashboardPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useProductionDashboard();
  const machine = useMachineLoading();
  const c = data?.counters;
  const supplyChain = data?.supplyChain;
  // Open Job Cards — 25 cards a page.
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
  // ▶ Start / ✚ Log on the Ready rows open Op Entry — the same gate the Job
  // Queue uses for the same two links.
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;

  return (
    <div>
      <ListHeader title="Production Dashboard" icon="📊" updating={isFetching && !isLoading} />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading dashboard…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load dashboard. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards — legacy L3756-3777. ONE StatStrip row. */}
          <div style={{ marginBottom: 16 }}>
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

          {/* Machine-wise Pending Work — look-only widget (ADR-199). */}
          <MachinePendingPanel
            machines={machine.data?.machines ?? []}
            ops={machine.data?.ops ?? []}
            isLoading={machine.isLoading}
          />

          {/* Open JC cards — look-only widget (ADR-199). */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Open Job Cards</span>
              <Link to="/job-cards" className="btn btn-ghost btn-sm">
                All JCs →
              </Link>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 8,
                padding: 12,
              }}
            >
              {openJobCards.length === 0 ? (
                <div className="empty-state" style={{ padding: 16 }}>
                  No open Job Cards.
                </div>
              ) : (
                openJobCards.map((jc) => <JcCard key={jc.jobCardId} jc={jc} />)
              )}
            </div>
            <div style={{ padding: '0 12px 10px' }}>
              <ListFooter
                total={jcs.data?.total ?? 0}
                noun="open job card"
                page={jcPage}
                pageSize={LIST_PAGE_SIZE}
                onPage={onJcPage}
              />
            </div>
          </div>

          {/* Available Now — the MAIN list, ADR-199 fit table. Legacy renders
              this panel only when readyOps is non-empty (no empty state); it
              stays up while a ▾ filter is on so the filter can be cleared. */}
          {readyTotal > 0 || readySf.filtering ? (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">Available Now</span>
                <span className="text3" style={{ fontSize: 11 }}>
                  {/* Server's full-scope count (every ready op, not the page). */}
                  {c?.readyOps ?? 0} operations
                </span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.prodDashboardReady}
                columns={prodReadyColumns()}
                rows={readyToProcess}
                rowKey={(op) => op.jcOpId}
                sortFilterServer={readySf}
                emptyText="No operations match."
                defaultPinned={PROD_READY_DEFAULT_PINNED}
                defaultHidden={PROD_READY_DEFAULT_HIDDEN}
                rowClassName={prodReadyRowTint}
                rowMenu={(op) => prodReadyRowMenu(op, canOpEntry)}
                renderLink={renderJcOpsLink}
              />
              <div style={{ padding: '0 12px 10px' }}>
                <ListFooter
                  total={readyTotal}
                  noun="operation"
                  page={readyPage}
                  pageSize={LIST_PAGE_SIZE}
                  onPage={onReadyPage}
                />
              </div>
            </div>
          ) : null}

          {/* Supply Chain Snapshot — look-only widget (ADR-199). */}
          <SupplyChainPanel data={supplyChain} />
        </>
      )}
    </div>
  );
}
