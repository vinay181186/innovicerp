// Production Dashboard (Production Wave 4). Ports legacy renderDashboard
// (HTML L3658): 4 stat cards + Open JC cards + Ready to Process Now, in
// legacy's panel order. Legacy chrome.
//
// Not ported (data absent from GET /production-dashboard — see report):
//  - "🏭 Machine-wise Pending Work" (L3780-3788) needs calc.machineLoad
//    (per-machine pending op rows). Computing it browser-side would violate
//    CLAUDE.md rule 1, so the panel is omitted rather than approximated.
//  - "🏬 Supply Chain Snapshot" (L3804-3838) reads db.items/purchaseOrders/grn.
//  - The `.op-chain` flow viz on JC cards (L3719/L3726) needs jc.ops; the
//    `.op-node` classes are also absent from innovic-theme.css.

import type { ProductionDashboardJc, ProductionDashboardReadyOp } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useProductionDashboard } from '../api';

export const productionDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-dashboard',
  component: ProductionDashboardPage,
});

// Legacy badge() (HTML L1959-1970) maps op status → colour. 'In Progress'
// (b-yellow) and 'Running' (b-running) are declared ONLY in legacy's print
// stylesheet (L10559-10561), never in its main sheet at L10, so legacy renders
// both as an unstyled `.badge` on screen. Empty class reproduces that exactly;
// neither class exists in our theme either. Mirrors machine-loading's map.
const OP_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  complete: { label: 'Complete', cls: 'b-green' },
  in_progress: { label: 'In Progress', cls: '' },
  running: { label: 'Running', cls: '' },
  available: { label: 'Available', cls: 'b-blue' },
  waiting: { label: 'Waiting', cls: 'b-red' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
};

function OpStatusBadge({ status }: { status: string }): React.JSX.Element {
  const known = OP_STATUS_BADGES[status];
  // Legacy's fallback is `m[status] || 'b-grey'` with the raw status text.
  const label = known?.label ?? status.replaceAll('_', ' ');
  const cls = known ? known.cls : 'b-grey';
  return <span className={cls ? `badge ${cls}` : 'badge'}>{label}</span>;
}

function ProductionDashboardPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useProductionDashboard();
  const c = data?.counters;
  const openJobCards = data?.openJobCards ?? [];
  const readyToProcess = data?.readyToProcess ?? [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Production Dashboard
        </div>
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading dashboard…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load dashboard'}
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards — legacy L3756-3777. Legacy's inline
              `grid-template-columns:repeat(4,1fr)` is a no-op: `.stat-grid`
              already declares it (legacy L96 = theme L292). Copying it would
              override our @media(max-width:768px) 2-col rule (theme L864), so
              the bare class matches legacy's render AND stays responsive. */}
          <div className="stat-grid">
            <div className="stat-card cyan">
              <div className="stat-label">Open Job Cards</div>
              <div className="stat-val cyan">{c?.openJc ?? 0}</div>
              <div className="stat-sub">
                {c?.totalJc ?? 0} total · {c?.noOpsJc ?? 0} no-ops
              </div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Total Pending Components</div>
              <div className="stat-val amber">{c?.pendingQty ?? 0}</div>
              <div className="stat-sub">pcs still to be manufactured</div>
            </div>
            <div
              className="stat-card"
              style={{ borderColor: (c?.runningOps ?? 0) > 0 ? 'var(--green)' : 'var(--border)' }}
            >
              <div className="stat-label">Running Now</div>
              <div
                className="stat-val"
                style={{ color: (c?.runningOps ?? 0) > 0 ? 'var(--green)' : 'var(--text3)' }}
              >
                {c?.runningOps ?? 0}
              </div>
              <div className="stat-sub">operations on machines</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Ready to Start</div>
              <div className="stat-val green">{c?.readyQty ?? 0}</div>
              <div className="stat-sub">pcs available right now</div>
            </div>
          </div>

          {/* Open JC cards — legacy L3791-3799 */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">📋 Open Job Cards</span>
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
                  ✓ No open job cards
                </div>
              ) : (
                openJobCards.map((jc) => <JcCard key={jc.jobCardId} jc={jc} />)
              )}
            </div>
          </div>

          {/* Ready to Process Now — legacy L3735-3752. Legacy renders this panel
              only when readyOps is non-empty (no empty state). */}
          {readyToProcess.length > 0 ? (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-hdr">
                <span className="panel-title">⚡ Ready to Process Now</span>
                <span className="text3" style={{ fontSize: 11 }}>
                  {/* Server's full-scope count. `readyToProcess` is LIMIT 100,
                      so binding .length here froze the figure at 100. */}
                  {c?.readyOps ?? 0} operations with available qty
                </span>
              </div>
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>JC No.</th>
                      <th>Op</th>
                      <th>Operation</th>
                      <th>Machine</th>
                      <th>Order Qty</th>
                      <th>Completed</th>
                      <th style={{ color: 'var(--amber)' }}>Available</th>
                      <th>Pending Hrs</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readyToProcess.map((op) => (
                      <ReadyRow key={op.jcOpId} op={op} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// Legacy machTag() (HTML L1978-1984) — a `.tag` chip with the code in bold and
// the machine NAME beneath it. The name is not on this payload, so only the
// code block renders (legacy's own `m`-not-found branch does the same).
function MachineTag({ code }: { code: string }): React.JSX.Element {
  return (
    <span
      className="tag"
      style={{
        background: 'var(--bg4)',
        color: 'var(--cyan)',
        display: 'inline-block',
        lineHeight: 1.25,
        verticalAlign: 'top',
      }}
    >
      <span style={{ fontWeight: 700, display: 'block' }}>{code}</span>
    </span>
  );
}

function ReadyRow({ op }: { op: ProductionDashboardReadyOp }): React.JSX.Element {
  return (
    <tr>
      <td className="td-code cyan">
        <Link
          to="/op-entry"
          search={{ jc: op.jobCardCode }}
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          title="Open in Op Entry"
        >
          {op.jobCardCode}
        </Link>
      </td>
      <td className="td-ctr mono">{op.opSeq}</td>
      <td>{op.operation}</td>
      <td>{op.machineCode ? <MachineTag code={op.machineCode} /> : '—'}</td>
      <td className="td-ctr">{op.orderQty}</td>
      <td className="td-ctr green mono fw-700">{op.completedQty}</td>
      <td className="td-ctr">
        <span className="mono fw-700 amber" style={{ fontSize: 16 }}>
          {op.available}
        </span>
      </td>
      <td className="td-ctr mono" style={{ color: 'var(--orange)' }}>
        {op.pendingHrs}h
      </td>
      <td>
        <OpStatusBadge status={op.computedStatus} />
      </td>
    </tr>
  );
}

function JcCard({ jc }: { jc: ProductionDashboardJc }): React.JSX.Element {
  const pct = jc.totalOps > 0 ? Math.round((jc.doneOps / jc.totalOps) * 100) : 0;
  return (
    <Link
      to="/op-entry"
      search={{ jc: jc.code }}
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        padding: '10px 12px',
        background: 'var(--bg3)',
        borderRadius: 8,
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <span className="mono fw-700 cyan" style={{ fontSize: 12 }}>
          {jc.code}
        </span>
        {/* Legacy badge(jc.priority) (L3723): High→b-amber, Normal→b-grey */}
        <div style={{ display: 'flex', gap: 4 }}>
          <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
            {jc.priority === 'high' ? 'High' : 'Normal'}
          </span>
        </div>
      </div>
      <div
        className="text2"
        style={{
          fontSize: 11,
          marginBottom: 5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {jc.itemName ?? jc.itemCode ?? '—'} — <b>{jc.orderQty} pcs</b>
      </div>
      {/* Legacy progBar(pct,'#3b82f6') (L1972-1974, called L3728). The literal
          is a dark-theme blue → mapped to the nearest token, var(--blue).
          L3728 drops the bare `.prog-wrap` straight into a flex row where it
          has no width and collapses; legacy's other progBar-in-flex call site
          (L5133) wraps it in `flex:1`, which is applied here so the bar stays
          visible. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <div className="prog-wrap">
            <div
              className="prog-bar"
              style={{ width: `${Math.min(100, pct)}%`, background: 'var(--blue)' }}
            />
          </div>
        </div>
        <span className="text3" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
          {pct}%
        </span>
      </div>
      {jc.dueDate ? (
        <div className="text3" style={{ fontSize: 10, marginTop: 4 }}>
          Due: {jc.dueDate}
        </div>
      ) : null}
    </Link>
  );
}
