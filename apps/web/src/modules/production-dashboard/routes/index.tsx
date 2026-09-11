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
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { MachineChip, MachineSplitLines } from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';
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
                      {/* A JC number says WHICH JOB, not which part. This panel
                          is the full-width work list, so unlike the 110px
                          machine-load cell the code and the name each get their
                          own column instead of sharing one token. */}
                      <th>Item Code</th>
                      <th>Item Name</th>
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
                  {/* The JC number opens that card. Colour and mono face are
                      inherited from the cell so the code looks exactly as it
                      did before it became reachable. */}
                  <td className="mono cyan" style={{ fontSize: 11 }}>
                    <Link
                      to="/job-cards/$id"
                      params={{ id: o.jobCardId }}
                      title="View job card status"
                      style={{
                        color: 'inherit',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {o.jobCardCode}
                    </Link>
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
                    {/* The cell is capped at 110px and ellipsised, so it holds one
                        token and no more. The code carries the drawing revision
                        the operator is being asked to check, so the code leads
                        and the name is only the fallback for a card with none. */}
                    {itemCodeWithRev(o.itemCode, o.itemRevision, o.itemName ?? '')}
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
      {/* DESTINATION CHANGED (user request, 2026-09-11): this code used to open
          Op Entry pre-filtered to the card. Everywhere in the app a JC number
          now goes to the job card itself, and one code that jumped somewhere
          else was the inconsistency. Op Entry is still reachable from its own
          menu entry; only this link moved. */}
      <td className="td-code cyan">
        <Link
          to="/job-cards/$id"
          params={{ id: op.jobCardId }}
          style={{ color: 'var(--cyan)', textDecoration: 'none', whiteSpace: 'nowrap' }}
          title="View job card status"
        >
          {op.jobCardCode}
        </Link>
      </td>
      {/* The item the card is for. The code leads because it carries the drawing
          revision (CODE/REV) the operator works to; a card with no SO line
          behind it has no revision and prints the bare code. */}
      <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
        {itemCodeWithRev(op.itemCode, op.itemRevision, '')}
      </td>
      {/* Part names run long, so the name truncates on one line and carries the
          full text in its tooltip. Nothing to show renders empty, not a dash. */}
      <td
        style={{
          fontSize: 11,
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={op.itemName ?? ''}
      >
        {op.itemName ?? ''}
      </td>
      <td className="td-ctr mono">{op.opSeq}</td>
      <td>{op.operation}</td>
      <td>
        {op.machineCode ? <MachineTag code={op.machineCode} /> : '—'}
        {/* ADR-126 — this column is the machine the REMAINING qty runs on. Once
            an op has run on more than one machine it stops matching the Completed
            figure beside it, so say so instead of implying the current machine
            made everything. One machine (the norm) renders exactly as before —
            MachineChip returns null. */}
        <MachineChip machines={op.machines} />
      </td>
      <td className="td-ctr">{op.orderQty}</td>
      <td className="td-ctr green mono fw-700">
        {op.completedQty}
        {/* The per-machine breakdown of that total (ADR-126). Renders nothing
            unless the op ran on more than one machine. */}
        <MachineSplitLines machines={op.machines} />
      </td>
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
  const navigate = useNavigate();
  const pct = jc.totalOps > 0 ? Math.round((jc.doneOps / jc.totalOps) * 100) : 0;
  // Resolved once, with an empty fallback, so the card can tell a real item code
  // from the part-name stand-in it falls back to. Only a genuine code gets the
  // promoted treatment below; a part name is allowed to stay quiet.
  const itemCode = itemCodeWithRev(jc.itemCode, jc.itemRevision, '');
  // The whole card still opens Op Entry for this card, exactly as before; only
  // the JC number inside it now goes to the job card. An <a> cannot legally
  // contain another <a> — the browser silently breaks the nesting apart — so the
  // card becomes a clickable div with the same destination and the code becomes
  // the real link. Same shape as the Job Cards list (job-cards/routes/list.tsx),
  // where the band is a click handler and the code inside it is a <Link>.
  return (
    <div
      onClick={() => void navigate({ to: '/op-entry', search: { jc: jc.code } })}
      style={{
        display: 'block',
        padding: '10px 12px',
        background: 'var(--bg3)',
        borderRadius: 8,
        border: '1px solid var(--border)',
        cursor: 'pointer',
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
        {/* stopPropagation so the code wins over the card's own click: without
            it the card would navigate to Op Entry at the same moment the link
            navigates to the job card. `.cyan` keeps the colour, so only the
            browser's underline has to be undone inline. */}
        <Link
          to="/job-cards/$id"
          params={{ id: jc.jobCardId }}
          title="View job card status"
          className="mono fw-700 cyan"
          style={{ fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}
          onClick={(e) => e.stopPropagation()}
        >
          {jc.code}
        </Link>
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
        {/* The item code is the primary value on this card — it is how the part
            gets matched to its drawing — so it takes the darkest text token and
            the bold weight. When there is no code the line still falls back to
            the part name, and a name stays on the muted line colour. */}
        {itemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {itemCode}
          </span>
        ) : (
          (jc.itemName ?? '—')
        )}{' '}
        —{' '}
        <b>{jc.orderQty} pcs</b>
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
    </div>
  );
}
