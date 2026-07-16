// Machine Loading (Production Wave 3). Ports legacy renderLoading (HTML L5021):
// machine cards + Operation View / Job Queue View toggle + Capacity Summary.
// Legacy chrome (.panel / .innovic-table / .badge); cards use inline tokens
// (.mach-card not ported to theme).

import type { MachineLoadCard, MachineLoadOp, MachineLoadStatus } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Printer } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMyCompany } from '../../settings/api';
import { useMachineLoading } from '../api';
import { printMachineQueue } from '../lib/print-machine-queue';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
  view: z.enum(['ops', 'queue']).optional(),
});

export const machineLoadingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machine-loading',
  validateSearch: searchSchema,
  component: MachineLoadingPage,
});

// Legacy badge() (HTML L1959-1970) maps load status → colour:
// Overloaded→b-red · High Load→b-amber · Manageable→b-green · Clear→b-green.
function loadBadgeClass(status: MachineLoadStatus): string {
  if (status === 'Overloaded') return 'b-red';
  if (status === 'High Load') return 'b-amber';
  return 'b-green'; // Manageable + Clear (legacy L1963)
}

// Legacy badge() op-status map (L1961-1963). `b-yellow` (In Progress) and
// `b-running` (Running) are declared ONLY in legacy's print-only <style> block
// (L10559-10561), never in its main sheet at L10 — so legacy renders both as an
// unstyled `.badge` pill on screen. Empty class here reproduces that exactly;
// neither class exists in our theme either.
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

function barColor(pct: number): string {
  if (pct > 100) return 'var(--red)';
  if (pct > 70) return 'var(--amber)';
  if (pct > 0) return 'var(--green)';
  return 'var(--bg5)';
}

// Legacy progBar() (L1972-1975) — .prog-wrap/.prog-bar are ported to our theme
// (innovic-theme.css L763/L769); only the width+colour are inline, as in legacy.
function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  return (
    <div className="prog-wrap">
      <div className="prog-bar" style={{ width: `${Math.min(100, pct)}%`, background: barColor(pct) }} />
    </div>
  );
}

function MachineLoadingPage(): React.JSX.Element {
  const search = machineLoadingRoute.useSearch();
  const navigate = machineLoadingRoute.useNavigate();
  const { data, isLoading, isFetching, isError, error } = useMachineLoading();
  const { data: company } = useMyCompany();

  const view = search.view ?? 'ops';
  const selMachineId = search.m ?? null;

  const machines = data?.machines ?? [];
  const allOps = data?.ops ?? [];

  function onPrintQueue(machineId: string | null): void {
    if (!printMachineQueue({ machines, ops: allOps, company, machineId })) {
      window.alert('Allow popups to print.');
    }
  }

  // Operation View re-applies legacy's narrow ops filter (renderLoading L5060:
  // available > 0 OR In Progress). The service now returns the wider Job-Queue
  // set (all non-complete ops) so the Job Queue View can surface waiting /
  // qc_pending / running (ISSUE-068); this keeps the ops table unchanged.
  const filteredOps = useMemo(
    () =>
      allOps.filter(
        (o) =>
          (selMachineId ? o.machineId === selMachineId : true) &&
          (o.available > 0 || o.computedStatus === 'in_progress'),
      ),
    [allOps, selMachineId],
  );

  const queueMachines = useMemo(
    () => (selMachineId ? machines.filter((m) => m.machineId === selMachineId) : machines),
    [machines, selMachineId],
  );

  // Legacy's selMach IS the machine code (its PK); ours is a uuid, so the panel
  // title (legacy L5179: `${selMach} — Job Queue`) needs a lookup.
  const selMachineCode = selMachineId
    ? (machines.find((m) => m.machineId === selMachineId)?.machineCode ?? null)
    : null;

  function selectMachine(id: string): void {
    void navigate({
      search: (prev) => ({ ...prev, m: id, view: 'queue' }),
      replace: true,
    });
  }
  function setView(v: 'ops' | 'queue'): void {
    void navigate({ search: (prev) => ({ ...prev, view: v }), replace: true });
  }
  function clearFilter(): void {
    void navigate({ search: (prev) => ({ ...prev, m: undefined }), replace: true });
  }

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
          Machine Loading
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          <div
            style={{
              display: 'flex',
              background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setView('ops')}
              style={{
                borderRadius: 0,
                background: view === 'ops' ? 'var(--blue2)' : 'transparent',
                color: view === 'ops' ? '#fff' : 'var(--text2)',
              }}
            >
              Operation View
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setView('queue')}
              style={{
                borderRadius: 0,
                background: view === 'queue' ? 'var(--blue2)' : 'transparent',
                color: view === 'queue' ? '#fff' : 'var(--text2)',
              }}
            >
              Job Queue View
            </button>
          </div>
          {selMachineId ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilter}>
              All Machines ×
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onPrintQueue(selMachineId)}
            disabled={machines.length === 0}
            title={selMachineId ? 'Print this machine queue' : 'Print all machine queues'}
          >
            <Printer size={13} /> Print Queue
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machine load…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load machine loading'}
          </div>
        </div>
      ) : (
        <>
          {/* Machine cards — legacy .mach-cards (L221): 5 fixed columns, gap 10,
              margin-bottom 16. Not ported to our theme, so inlined verbatim. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {machines.map((m) => (
              <MachineLoadCardView
                key={m.machineId}
                card={m}
                selected={m.machineId === selMachineId}
                onClick={() => selectMachine(m.machineId)}
              />
            ))}
            {machines.length === 0 ? (
              <div className="text3" style={{ fontSize: 12 }}>
                No machines configured.
              </div>
            ) : null}
          </div>

          {view === 'ops' ? (
            <OperationView ops={filteredOps} selMachineCode={selMachineCode} />
          ) : (
            <JobQueueView machines={queueMachines} ops={allOps} onPrint={onPrintQueue} />
          )}

          <CapacitySummary machines={machines} />
        </>
      )}
    </div>
  );
}

function MachineLoadCardView({
  card,
  selected,
  onClick,
}: {
  card: MachineLoadCard;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const pct = Math.min(150, Math.round(card.loadPct * 100));
  return (
    // Legacy .mach-card (L222) + .mach-card.sel (L223) inlined — neither is in
    // our theme. Selected state mirrors legacy's own intent: renderLoading emits
    // `.selected`, which legacy never defines (only `.sel`), so its selected card
    // gets no highlight; renderJobQueue (L10371) works around the same bug by
    // inlining the border/shadow. We keep the highlight — see report.
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderColor: selected ? 'var(--cyan)' : 'var(--border)',
        boxShadow: selected ? '0 0 0 1px var(--cyan)' : undefined,
        borderRadius: 'var(--radius2)',
        padding: 14,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* Legacy .mach-id (L224) is not in our theme — inline approximation kept. */}
      <div className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 13 }}>
        {card.machineCode}
      </div>
      <div className="text3" style={{ fontSize: 10, marginBottom: 2 }}>
        {card.name}
      </div>
      <div className="text3 mono" style={{ fontSize: 10, marginBottom: 8 }}>
        {card.machineType ?? '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Num val={card.totalAvailQty} lbl="Avail" color="var(--amber)" />
        <Num val={card.pendingHrs} lbl="Hrs" color="var(--red)" />
        <Num val={card.daysToClear} lbl="Days" />
      </div>
      <ProgBar pct={pct} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          alignItems: 'center',
        }}
      >
        <span className="mono text3" style={{ fontSize: 10 }}>
          {pct}%
        </span>
        <span className={`badge ${loadBadgeClass(card.loadStatus)}`}>{card.loadStatus}</span>
      </div>
    </button>
  );
}

function Num({ val, lbl, color }: { val: number; lbl: string; color?: string }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="mono fw-700" style={{ fontSize: 14, color: color ?? 'var(--text)' }}>
        {val}
      </div>
      <div className="text3" style={{ fontSize: 9 }}>
        {lbl}
      </div>
    </div>
  );
}

// `queue` = legacy's qRows treatment (L5102-5103): the next-up job (available>0)
// gets a tinted row and an amber index. The ops view (L5061-5075) has neither.
function OpRow({
  op,
  idx,
  queue = false,
}: {
  op: MachineLoadOp;
  idx: number;
  queue?: boolean;
}): React.JSX.Element {
  const isNext = op.available > 0;
  if (queue) {
    return (
      <tr style={isNext ? { background: 'rgba(255,176,32,0.04)' } : undefined}>
        <td
          className="td-ctr mono fw-700"
          style={{ color: isNext ? 'var(--amber)' : 'var(--text3)', fontSize: 13 }}
        >
          {idx + 1}
        </td>
        <OpRowCells op={op} />
      </tr>
    );
  }
  return (
    <tr>
      <td className="td-ctr mono text3">{idx + 1}</td>
      <OpRowCells op={op} />
    </tr>
  );
}

function OpRowCells({ op }: { op: MachineLoadOp }): React.JSX.Element {
  return (
    <>
      <td className="td-code cyan">{op.jobCardCode}</td>
      <td style={{ fontSize: 11 }}>
        {op.itemCode ?? ''}
        {op.itemName ? ` — ${op.itemName}` : ''}
      </td>
      <td className="td-ctr mono text3" style={{ fontSize: 11 }}>
        {op.soCode ?? '—'}
      </td>
      <td className="td-ctr mono">{op.opSeq}</td>
      <td>{op.operation}</td>
      <td>
        <span className={`badge ${op.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {op.priority === 'high' ? 'High' : 'Normal'}
        </span>
      </td>
      <td className="text2 td-ctr" style={{ fontSize: 11 }}>
        {op.dueDate ?? '—'}
      </td>
      <td className="td-ctr mono">{op.orderQty}</td>
      <td className="td-ctr green mono fw-700">{op.completedQty}</td>
      <td className="td-ctr">
        <span
          className="mono fw-700"
          style={{ fontSize: 15, color: op.available > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {op.available}
        </span>
      </td>
      <td className="td-ctr">
        <span className="mono fw-700" style={{ color: 'var(--red)' }}>
          {op.pendingHrs}h
        </span>
      </td>
      <td>
        <OpStatusBadge status={op.computedStatus} />
      </td>
    </>
  );
}

function OperationView({
  ops,
  selMachineCode,
}: {
  ops: MachineLoadOp[];
  selMachineCode: string | null;
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">
          {selMachineCode
            ? `${selMachineCode} — Job Queue`
            : 'All Open Operations — sorted by Priority → Due Date'}
        </span>
        <span className="mono" style={{ color: 'var(--amber)', fontSize: 12 }}>
          {ops.length} ops
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th>
              <th>JC No.</th>
              <th>Part No / Item</th>
              <th>SO No.</th>
              <th>Op</th>
              <th>Operation</th>
              <th>Priority</th>
              <th>Due</th>
              <th>Order</th>
              <th>Done</th>
              <th style={{ color: 'var(--amber)' }}>Avail★</th>
              <th style={{ color: 'var(--red)' }}>Pend Hrs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? (
              <tr>
                <td colSpan={13} className="empty-state">
                  No pending operations
                </td>
              </tr>
            ) : (
              ops.map((op, i) => <OpRow key={op.jcOpId} op={op} idx={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JobQueueView({
  machines,
  ops,
  onPrint,
}: {
  machines: MachineLoadCard[];
  ops: MachineLoadOp[];
  onPrint: (machineId: string) => void;
}): React.JSX.Element {
  if (machines.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state" style={{ padding: 32 }}>
          No machines configured
        </div>
      </div>
    );
  }
  return (
    <div>
      {machines.map((m) => {
        const machOps = ops.filter((o) => o.machineId === m.machineId);
        const pct = Math.min(150, Math.round(m.loadPct * 100));
        // Legacy renders an empty machine with a reduced header and a hardcoded
        // badge('Clear') — not m.loadStatus (L5083-5091).
        if (machOps.length === 0) {
          return (
            <div className="panel" key={m.machineId} style={{ marginBottom: 12 }}>
              <div className="panel-hdr" style={{ background: 'var(--bg4)' }}>
                <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 14 }}>
                  {m.machineCode}
                </span>
                <span className="text3 mono" style={{ fontSize: 11 }}>
                  {m.name}
                </span>
                <span className="badge b-green">Clear</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onPrint(m.machineId)}
                  title={`Print ${m.machineCode} queue`}
                >
                  <Printer size={12} /> Print
                </button>
              </div>
              <div className="empty-state" style={{ padding: 20 }}>
                ✓ No jobs in queue
              </div>
            </div>
          );
        }
        return (
          <div className="panel" key={m.machineId} style={{ marginBottom: 14 }}>
            <div className="panel-hdr" style={{ background: 'var(--bg4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 15 }}>
                  {m.machineCode}
                </span>
                <span className="text2" style={{ fontSize: 12 }}>
                  {m.name} — {m.machineType ?? '—'}
                </span>
                <div style={{ flex: 1, maxWidth: 120 }}>
                  <ProgBar pct={pct} />
                </div>
                <span className="mono text3" style={{ fontSize: 11 }}>
                  {pct}% · {m.pendingHrs}h · {m.daysToClear}d
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${loadBadgeClass(m.loadStatus)}`}>{m.loadStatus}</span>
                <span className="mono" style={{ color: 'var(--amber)', fontSize: 11 }}>
                  {machOps.length} jobs
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onPrint(m.machineId)}
                  title={`Print ${m.machineCode} queue`}
                >
                  <Printer size={12} /> Print
                </button>
              </div>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>JC No.</th>
                    <th>Part No / Item</th>
                    <th>SO No.</th>
                    <th>Op</th>
                    <th>Operation</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Order</th>
                    <th>Done</th>
                    <th style={{ color: 'var(--amber)' }}>Avail★</th>
                    <th style={{ color: 'var(--red)' }}>Pend Hrs</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {machOps.map((op, i) => (
                    <OpRow key={op.jcOpId} op={op} idx={i} queue />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CapacitySummary({ machines }: { machines: MachineLoadCard[] }): React.JSX.Element {
  return (
    // Legacy `<div class="panel mt-16">` (L5189); .mt-16 (L268) is not in our theme.
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Capacity Summary</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Name</th>
              <th>Type</th>
              <th>Open Ops</th>
              <th>Avail Qty</th>
              <th>Pending Hrs</th>
              <th>Daily Cap</th>
              <th>Days to Clear</th>
              <th>Loading %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-state">
                  No machines
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machineId}>
                  <td className="td-code">{m.machineCode}</td>
                  <td>{m.name}</td>
                  <td className="text2">{m.machineType ?? '—'}</td>
                  <td className="td-ctr mono">{m.openOps}</td>
                  <td className="td-ctr mono fw-700 amber">{m.totalAvailQty}</td>
                  <td className="td-ctr">
                    <span className="mono fw-700" style={{ color: 'var(--red)' }}>
                      {m.pendingHrs}h
                    </span>
                  </td>
                  <td className="td-ctr mono green">{m.dailyCap}h</td>
                  <td className="td-ctr mono">{m.daysToClear}d</td>
                  <td className="td-ctr mono fw-700">{Math.round(m.loadPct * 100)}%</td>
                  <td>
                    <span className={`badge ${loadBadgeClass(m.loadStatus)}`}>{m.loadStatus}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
