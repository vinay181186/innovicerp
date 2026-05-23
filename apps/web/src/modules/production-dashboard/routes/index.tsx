// Production Dashboard (Production Wave 4). Ports legacy renderDashboard
// (HTML L3658): stat tiles + open JC cards + Ready to Process Now. Legacy
// chrome. Per-machine pending-queue panels live on the Machine Loading page
// (Job Queue View); the op-chain flow viz on JC cards is deferred (POLISH).

import type {
  ProductionDashboardJc,
  ProductionDashboardReadyOp,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useProductionDashboard } from '../api';

export const productionDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-dashboard',
  component: ProductionDashboardPage,
});

interface Tile {
  label: string;
  value: number;
  color: string;
  to?: string;
}

function ProductionDashboardPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useProductionDashboard();
  const c = data?.counters;

  const tiles: Tile[] = c
    ? [
        { label: 'Open Job Cards', value: c.openJc, color: 'var(--cyan)', to: '/job-cards' },
        { label: 'Running Ops', value: c.runningOps, color: 'var(--amber)', to: '/op-entry/running' },
        { label: 'Pending Qty', value: c.pendingQty, color: 'var(--red)' },
        { label: 'Ready Ops', value: c.readyOps, color: 'var(--green)', to: '/machine-loading' },
        { label: 'Ready Qty', value: c.readyQty, color: 'var(--green)' },
        { label: 'Outsource Ops', value: c.outsourceOps, color: 'var(--purple)' },
        { label: 'At Vendor', value: c.atVendor, color: 'var(--purple)' },
        { label: 'No-Ops JC', value: c.noOpsJc, color: 'var(--text3)' },
      ]
    : [];

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
          {/* Stat tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {tiles.map((t) => (
              <StatTile key={t.label} tile={t} />
            ))}
          </div>

          {/* Ready to process now */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">⚡ Ready to Process Now</span>
              <span className="text3" style={{ fontSize: 11 }}>
                {data?.readyToProcess.length ?? 0} operations with available qty
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
                    <th style={{ color: 'var(--red)' }}>Pending Hrs</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.readyToProcess ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty-state">
                        ✓ Nothing waiting — all caught up
                      </td>
                    </tr>
                  ) : (
                    (data?.readyToProcess ?? []).map((op) => <ReadyRow key={op.jcOpId} op={op} />)
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Open job cards */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">Open Job Cards</span>
              <span className="text3" style={{ fontSize: 11 }}>
                {data?.openJobCards.length ?? 0}
              </span>
            </div>
            <div className="panel-body">
              {(data?.openJobCards ?? []).length === 0 ? (
                <div className="empty-state">✓ No open job cards</div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 10,
                  }}
                >
                  {(data?.openJobCards ?? []).map((jc) => (
                    <JcCard key={jc.jobCardId} jc={jc} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({ tile }: { tile: Tile }): React.JSX.Element {
  const body = (
    <div
      style={{
        border: '1px solid var(--border)',
        borderTop: `3px solid ${tile.color}`,
        borderRadius: 10,
        background: 'var(--bg3)',
        padding: '14px 16px',
        height: '100%',
      }}
    >
      <div className="mono fw-700" style={{ fontSize: 26, color: tile.color }}>
        {tile.value}
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
        {tile.label}
      </div>
    </div>
  );
  if (tile.to) {
    return (
      <Link to={tile.to} style={{ textDecoration: 'none', color: 'inherit' }}>
        {body}
      </Link>
    );
  }
  return body;
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
      <td className="mono text3" style={{ fontSize: 11 }}>
        {op.machineCode ?? '—'}
      </td>
      <td className="td-ctr mono">{op.orderQty}</td>
      <td className="td-ctr green mono fw-700">{op.completedQty}</td>
      <td className="td-ctr">
        <span className="mono fw-700 amber" style={{ fontSize: 15 }}>
          {op.available}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono fw-700" style={{ color: 'var(--red)' }}>
          {op.pendingHrs}h
        </span>
      </td>
      <td className="text3" style={{ fontSize: 11, textTransform: 'capitalize' }}>
        {op.computedStatus.replaceAll('_', ' ')}
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
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}
      >
        <span className="mono fw-700 cyan" style={{ fontSize: 12 }}>
          {jc.code}
        </span>
        <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {jc.priority === 'high' ? 'High' : 'Normal'}
        </span>
      </div>
      <div
        className="text2"
        style={{
          fontSize: 11,
          marginBottom: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {jc.itemName ?? jc.itemCode ?? '—'} — <b>{jc.orderQty} pcs</b>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--bg5)', borderRadius: 3 }}>
          <div
            style={{ width: `${pct}%`, height: '100%', background: 'var(--blue2)', borderRadius: 3 }}
          />
        </div>
        <span className="text3" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
          {jc.doneOps}/{jc.totalOps} · {pct}%
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
