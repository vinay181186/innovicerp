// Production Dashboard (Production Wave 4). Ports legacy renderDashboard
// (HTML L3658), all 4 panels in legacy's order: stat cards → Machine-wise
// Pending Work → Open Job Cards → Ready to Process Now → Supply Chain Snapshot.
// Legacy chrome.
//
// Data reuse (no figure is recomputed in React — CLAUDE.md rule 1):
//  - "🏭 Machine-wise Pending Work" (L3780-3788) reads the existing
//    GET /machine-loading via useMachineLoading(); ops are grouped by machine
//    for display only. "Full Queue →" → our /job-queue route.
//  - "🏬 Supply Chain Snapshot" (L3804-3838) reads supplyChain on
//    GET /production-dashboard, whose figures reuse store-inventory +
//    sc-dashboard service formulas. "Store →" → our /store-inventory route.
//
// Not ported: the `.op-chain` flow viz on JC cards (L3719/L3726) needs jc.ops;
// the `.op-node` classes are also absent from innovic-theme.css.

import type {
  MachineLoadOp,
  ProductionDashboardJc,
  ProductionDashboardLowStockItem,
  ProductionDashboardReadyOp,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachineLoading } from '@/modules/machine-loading/api';
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
  const machine = useMachineLoading();
  const c = data?.counters;
  const openJobCards = data?.openJobCards ?? [];
  const readyToProcess = data?.readyToProcess ?? [];
  const supplyChain = data?.supplyChain;

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

          {/* Machine-wise Pending Work — legacy L3780-3788. Reuses the existing
              GET /machine-loading dataset; ops are grouped by machine here for
              layout only (no figures recomputed). */}
          <MachinePendingPanel
            machines={machine.data?.machines ?? []}
            ops={machine.data?.ops ?? []}
            isLoading={machine.isLoading}
          />

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

          {/* Supply Chain Snapshot — legacy L3804-3838. Rendered only when at
              least one figure is non-zero (legacy L3809 hide condition). */}
          <SupplyChainPanel data={supplyChain} />
        </>
      )}
    </div>
  );
}

// Machine-wise Pending Work (legacy L3670-3714 + L3780-3788). One card per
// machine; pending ops grouped from the machine-loading `ops` list (already
// server-sorted priority → due → op_seq, preserved within each group).
const DUE_SOON_ISO = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);

function MachinePendingPanel({
  machines,
  ops,
  isLoading,
}: {
  machines: { machineId: string; machineCode: string; name: string }[];
  ops: MachineLoadOp[];
  isLoading: boolean;
}): React.JSX.Element {
  const opsByMachine = new Map<string, MachineLoadOp[]>();
  for (const op of ops) {
    if (!op.machineId) continue;
    const list = opsByMachine.get(op.machineId);
    if (list) list.push(op);
    else opsByMachine.set(op.machineId, [op]);
  }

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">🏭 Machine-wise Pending Work</span>
        <Link to="/job-queue" className="btn btn-ghost btn-sm">
          Full Queue →
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 12,
          padding: 14,
        }}
      >
        {isLoading && machines.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machine load…
          </div>
        ) : machines.length === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            No machines configured
          </div>
        ) : (
          machines.map((m) => (
            <MachineCard key={m.machineId} machine={m} ops={opsByMachine.get(m.machineId) ?? []} />
          ))
        )}
      </div>
    </div>
  );
}

function MachineCard({
  machine,
  ops,
}: {
  machine: { machineId: string; machineCode: string; name: string };
  ops: MachineLoadOp[];
}): React.JSX.Element {
  const label = (
    <div>
      <span className="mono fw-700 cyan" style={{ fontSize: 12 }}>
        {machine.machineCode}
      </span>
      {machine.name ? (
        <span className="text3" style={{ fontSize: 11, marginLeft: 6 }}>
          {machine.name}
        </span>
      ) : null}
    </div>
  );

  if (ops.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 14,
          background: 'var(--bg2)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}
        >
          {label}
          <span className="badge b-grey">Idle</span>
        </div>
        <div
          className="text3"
          style={{ fontSize: 12, textAlign: 'center', padding: '8px 0' }}
        >
          — No pending work —
        </div>
      </div>
    );
  }

  const runCount = ops.filter((o) => o.computedStatus === 'running').length;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 14,
        background: 'var(--bg2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        {label}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="text3" style={{ fontSize: 10 }}>
            {ops.length} op{ops.length !== 1 ? 's' : ''}
          </span>
          {runCount > 0 ? (
            <span className="badge">● Running</span>
          ) : (
            <span className="badge b-amber">Pending</span>
          )}
        </div>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>JC No.</th>
              <th>Item</th>
              <th>Operation</th>
              <th>Status</th>
              <th style={{ color: 'var(--amber)' }}>Pending</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {ops.map((o) => {
              const dueSoon = o.dueDate != null && o.dueDate <= DUE_SOON_ISO;
              return (
                <tr key={o.jcOpId}>
                  <td className="mono cyan" style={{ fontSize: 11 }}>
                    {o.jobCardCode}
                  </td>
                  <td
                    style={{
                      fontSize: 11,
                      maxWidth: 110,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {o.itemName ?? o.itemCode ?? ''}
                  </td>
                  <td style={{ fontSize: 11 }}>{o.operation}</td>
                  <td className="td-ctr">
                    <OpStatusBadge status={o.computedStatus} />
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--amber)' }}>
                    {o.available}
                  </td>
                  <td
                    className="td-ctr"
                    style={{ fontSize: 10, color: dueSoon ? 'var(--red)' : 'var(--text3)' }}
                  >
                    {o.dueDate ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Supply Chain Snapshot (legacy L3804-3838). Four whole-master tiles + the
// low-stock item chips. Figures come pre-computed on the dashboard payload.
function SupplyChainPanel({
  data,
}: {
  data:
    | {
        lowStockCount: number;
        zeroStockCount: number;
        openPos: number;
        todayGrn: number;
        lowStockItems: ProductionDashboardLowStockItem[];
      }
    | undefined;
}): React.JSX.Element | null {
  if (!data) return null;
  const { lowStockCount, zeroStockCount, openPos, todayGrn, lowStockItems } = data;
  // Legacy L3809 — hide the whole panel when everything is zero.
  if (openPos === 0 && todayGrn === 0 && lowStockCount === 0 && zeroStockCount === 0) return null;

  const low = lowStockCount > 0;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">🏬 Supply Chain Snapshot</span>
        <Link to="/store-inventory" className="btn btn-ghost btn-sm">
          Store →
        </Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 10,
          padding: 14,
        }}
      >
        <ScTile
          label="Low Stock Alerts"
          value={lowStockCount}
          bg={low ? 'var(--red3)' : 'var(--bg3)'}
          border={low ? 'var(--red)' : 'var(--border)'}
          color={low ? 'var(--red)' : 'var(--text3)'}
        />
        <ScTile
          label="Zero Stock Items"
          value={zeroStockCount}
          bg="var(--amber3)"
          border="var(--amber)"
          color="var(--amber)"
        />
        <ScTile
          label="Open POs"
          value={openPos}
          bg="var(--blue3)"
          border="var(--blue)"
          color="var(--blue)"
        />
        <ScTile
          label="Today's GRN"
          value={todayGrn}
          bg="var(--green3)"
          border="var(--green)"
          color="var(--green)"
        />
      </div>
      {lowStockItems.length > 0 ? (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 6 }}>
            ⚠ Low Stock Items:
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lowStockItems.map((i) => (
              <span
                key={i.itemId}
                style={{
                  fontSize: 11,
                  background: 'var(--red3)',
                  border: '1px solid var(--red)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  color: 'var(--red2)',
                }}
              >
                {i.code} ({i.inStock} / min {i.minQty})
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScTile({
  label,
  value,
  bg,
  border,
  color,
}: {
  label: string;
  value: number;
  bg: string;
  border: string;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 10,
        background: bg,
        borderRadius: 8,
        border: `1px solid ${border}`,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 22, color }}>
        {value}
      </div>
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
