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

function loadBadgeClass(status: MachineLoadStatus): string {
  if (status === 'Overloaded') return 'b-red';
  if (status === 'High Load') return 'b-amber';
  if (status === 'Manageable') return 'b-green';
  return 'b-grey';
}

function barColor(pct: number): string {
  if (pct > 100) return 'var(--red)';
  if (pct > 70) return 'var(--amber)';
  if (pct > 0) return 'var(--green)';
  return 'var(--bg5)';
}

function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  return (
    <div style={{ height: 6, background: 'var(--bg5)', borderRadius: 3, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(100, pct)}%`,
          height: '100%',
          background: barColor(pct),
          borderRadius: 3,
        }}
      />
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

  const filteredOps = useMemo(
    () => (selMachineId ? allOps.filter((o) => o.machineId === selMachineId) : allOps),
    [allOps, selMachineId],
  );

  const queueMachines = useMemo(
    () => (selMachineId ? machines.filter((m) => m.machineId === selMachineId) : machines),
    [machines, selMachineId],
  );

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
          {/* Machine cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
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
            <OperationView ops={filteredOps} selMachineId={selMachineId} />
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
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        border: `2px solid ${selected ? 'var(--cyan)' : 'var(--border2)'}`,
        borderRadius: 10,
        background: selected ? 'var(--bg4)' : 'var(--bg3)',
        padding: 12,
        cursor: 'pointer',
      }}
    >
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

function OpRow({ op, idx }: { op: MachineLoadOp; idx: number }): React.JSX.Element {
  return (
    <tr>
      <td className="td-ctr mono text3">{idx + 1}</td>
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
      <td className="text3" style={{ fontSize: 11, textTransform: 'capitalize' }}>
        {op.computedStatus.replaceAll('_', ' ')}
      </td>
    </tr>
  );
}

function OperationView({
  ops,
  selMachineId,
}: {
  ops: MachineLoadOp[];
  selMachineId: string | null;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">
          {selMachineId
            ? 'Machine queue — sorted by Priority → Due Date'
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
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="empty-state" style={{ padding: 32 }}>
          No machines configured
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 16 }}>
      {machines.map((m) => {
        const machOps = ops.filter((o) => o.machineId === m.machineId);
        const pct = Math.min(150, Math.round(m.loadPct * 100));
        return (
          <div className="panel" key={m.machineId} style={{ marginBottom: 14 }}>
            <div className="panel-hdr">
              <span className="panel-title">
                <span className="mono fw-700">{m.machineCode}</span>{' '}
                <span className="text3" style={{ fontWeight: 400 }}>
                  {m.name} — {m.machineType ?? '—'}
                </span>{' '}
                <span className="mono text3" style={{ fontSize: 11 }}>
                  · {pct}% · {m.pendingHrs}h · {m.daysToClear}d
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              </span>
            </div>
            {machOps.length === 0 ? (
              <div className="empty-state" style={{ padding: 20 }}>
                ✓ No jobs in queue
              </div>
            ) : (
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
                      <OpRow key={op.jcOpId} op={op} idx={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CapacitySummary({ machines }: { machines: MachineLoadCard[] }): React.JSX.Element {
  return (
    <div className="panel">
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
