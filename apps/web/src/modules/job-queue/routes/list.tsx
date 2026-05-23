// Job Queue — mirrors legacy renderJobQueue (HTML L10363).
// Pending ops per machine with ↑↓ reorder buttons.

import { Link, createRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobQueue, useReorderJobQueue } from '../api';

const searchSchema = z.object({
  machine: z.string().optional(),
});

export const jobQueueRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-queue',
  validateSearch: (search) => searchSchema.parse(search),
  component: JobQueuePage,
});

function JobQueuePage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const search = jobQueueRoute.useSearch();
  const navigate = jobQueueRoute.useNavigate();
  const selectedMachineCode = search.machine ?? '';

  const { data, isLoading, isError, error } = useJobQueue({});
  const reorderMut = useReorderJobQueue();

  const machines = data?.machines ?? [];
  const selectedMachine = useMemo(
    () =>
      selectedMachineCode
        ? machines.find((m) => m.machineCode === selectedMachineCode) ?? null
        : null,
    [machines, selectedMachineCode],
  );
  const displayMachines = selectedMachine ? [selectedMachine] : machines;

  const setMachine = (code: string | null): void => {
    void navigate({ search: () => ({ machine: code ?? undefined }) });
  };

  const onMove = (machineId: string, opId: string, dir: 'up' | 'down'): void => {
    const machine = machines.find((m) => m.machineId === machineId);
    if (!machine) return;
    const ids = machine.rows.map((r) => r.jcOpId);
    const idx = ids.indexOf(opId);
    if (idx === -1) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    next[idx] = ids[swap]!;
    next[swap] = opId;
    reorderMut.mutate({ machineId, input: { jcOpIds: next } });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">⬛ Job Queue View</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {selectedMachine ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMachine(null)}
            >
              All Machines ×
            </button>
          ) : null}
        </div>
      </div>

      {/* Machine cards strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        {machines.map((m) => {
          const active = selectedMachine?.machineId === m.machineId;
          return (
            <div
              key={m.machineId}
              onClick={() => setMachine(m.machineCode)}
              style={{
                padding: 10,
                background: 'var(--bg2)',
                border: `1px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                boxShadow: active ? '0 0 0 2px rgba(0,136,187,.2)' : undefined,
                textAlign: 'center',
              }}
            >
              <div className="mono fw-700" style={{ fontSize: 13 }}>
                {m.machineCode}
              </div>
              <div className="text3" style={{ fontSize: 10, marginBottom: 4 }}>
                {m.machineType ?? ''}
              </div>
              {m.runningCount > 0 ? (
                <div style={{ color: 'var(--amber)', fontSize: 11, fontWeight: 700 }}>
                  ▶ {m.runningCount} running
                </div>
              ) : null}
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                {m.pendingCount} pending ops
              </div>
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          </div>
        </div>
      ) : displayMachines.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 32 }}>
            No pending operations
          </div>
        </div>
      ) : (
        displayMachines.map((m) => (
          <div key={m.machineId} className="panel" style={{ marginBottom: 14 }}>
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg4)',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span className="mono fw-700" style={{ fontSize: 15 }}>
                {m.machineCode}
              </span>
              <span className="text3" style={{ fontSize: 11 }}>
                {m.machineName ?? ''}
              </span>
              <span className="text3 mono" style={{ fontSize: 11 }}>
                {m.pendingHrs}h pending
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 700,
                    background:
                      m.pendingHrs > 80
                        ? 'rgba(239,68,68,0.10)'
                        : m.pendingHrs > 40
                          ? 'rgba(245,158,11,0.10)'
                          : 'rgba(34,197,94,0.10)',
                    color:
                      m.pendingHrs > 80
                        ? 'var(--red)'
                        : m.pendingHrs > 40
                          ? 'var(--amber)'
                          : 'var(--green)',
                  }}
                >
                  {m.pendingHrs > 80 ? 'Overloaded' : m.pendingHrs > 40 ? 'Busy' : 'Clear'}
                </span>
                <span
                  className="mono"
                  style={{ color: 'var(--amber)', fontSize: 11, fontWeight: 700 }}
                >
                  {m.pendingCount} jobs
                </span>
              </span>
            </div>
            {m.rows.length === 0 ? (
              <div className="empty-state" style={{ padding: 18 }}>
                ✓ No pending jobs for this machine
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Order</th>
                      <th className="td-ctr" style={{ width: 30 }}>
                        #
                      </th>
                      <th>JC No.</th>
                      <th>Part / SO</th>
                      <th className="td-ctr">Op</th>
                      <th>Operation</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th className="td-ctr">Order</th>
                      <th className="td-ctr" style={{ color: 'var(--green)' }}>
                        Done
                      </th>
                      <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                        Avail
                      </th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r, idx) => {
                      const isNext = r.available > 0 && !r.isRunning;
                      return (
                        <tr
                          key={r.jcOpId}
                          style={
                            isNext ? { background: 'rgba(245,158,11,0.04)' } : undefined
                          }
                        >
                          <td>
                            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{
                                  padding: '0 4px',
                                  visibility: idx > 0 && canWrite ? 'visible' : 'hidden',
                                }}
                                onClick={() => onMove(m.machineId, r.jcOpId, 'up')}
                                title="Move up"
                              >
                                <ChevronUp size={12} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{
                                  padding: '0 4px',
                                  visibility:
                                    idx < m.rows.length - 1 && canWrite ? 'visible' : 'hidden',
                                }}
                                onClick={() => onMove(m.machineId, r.jcOpId, 'down')}
                                title="Move down"
                              >
                                <ChevronDown size={12} />
                              </button>
                            </div>
                          </td>
                          <td
                            className="td-ctr mono fw-700"
                            style={{ color: isNext ? 'var(--amber)' : 'var(--text3)' }}
                          >
                            {idx + 1}
                          </td>
                          <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                            {r.jcCode}
                          </td>
                          <td>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: 'var(--cyan)',
                              }}
                            >
                              {r.itemCode ?? ''} {r.itemName ? `— ${r.itemName}` : ''}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {r.soCode ?? '—'}
                              {r.soCustomer ? ` · ${r.soCustomer}` : ''}
                            </div>
                          </td>
                          <td className="td-ctr mono">{r.opSeq}</td>
                          <td>{r.operation}</td>
                          <td>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 10,
                                fontSize: 10,
                                fontWeight: 700,
                                background: 'var(--bg4)',
                                color: 'var(--text2)',
                              }}
                            >
                              {r.priority}
                            </span>
                          </td>
                          <td className="text2" style={{ fontSize: 11 }}>
                            {r.dueDate ?? '—'}
                          </td>
                          <td className="td-ctr mono">{r.orderQty}</td>
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                            {r.completed}
                          </td>
                          <td className="td-ctr">
                            <span
                              className="mono fw-700"
                              style={{
                                fontSize: 15,
                                color: isNext ? 'var(--amber)' : 'var(--text3)',
                              }}
                            >
                              {r.available}
                            </span>
                          </td>
                          <td>
                            {r.isRunning ? (
                              <span
                                style={{
                                  color: 'var(--amber)',
                                  fontWeight: 700,
                                  fontSize: 12,
                                }}
                              >
                                ▶ Running
                              </span>
                            ) : (
                              <StatusBadge status={r.status} />
                            )}
                          </td>
                          <td>
                            {isNext && canWrite ? (
                              <Link
                                to="/op-entry"
                                search={{ jc: r.jcCode, op: r.jcOpId }}
                                className="btn btn-sm"
                                style={{
                                  background: 'rgba(34,197,94,0.10)',
                                  border: '1px solid rgba(34,197,94,0.30)',
                                  color: 'var(--green)',
                                  fontSize: 11,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                ✚ Log Op
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const v = status.toLowerCase();
  const colors: Record<string, string> = {
    complete: 'var(--green)',
    qc_pending: 'var(--amber)',
    running: 'var(--blue)',
    in_progress: 'var(--blue)',
    available: 'var(--cyan)',
    waiting: 'var(--text3)',
  };
  const c = colors[v] ?? 'var(--text3)';
  return (
    <span
      style={{
        padding: '2px 9px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}30`,
      }}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
