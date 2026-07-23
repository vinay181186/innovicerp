// Job Queue — mirrors legacy renderJobQueue (HTML L10363).
// Pending ops per machine with ↑↓ reorder buttons.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBackfillMachineIds, useJobQueue, useReorderJobQueue } from '../api';

const searchSchema = z.object({
  machine: z.string().optional(),
});

// Legacy L10406/L10407 — the ▲/▼ queue-move buttons are inline-styled in legacy.
const queueBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border2)',
  borderRadius: 3,
  padding: '0 4px',
  cursor: 'pointer',
  fontSize: 11,
  color: 'var(--text2)',
  lineHeight: 1.6,
};

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

  const isAdmin = me?.role === 'admin';
  const { data, isLoading, isError, error } = useJobQueue({});
  const reorderMut = useReorderJobQueue();
  const backfillMut = useBackfillMachineIds();

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
          {isAdmin ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={backfillMut.isPending}
              title="Link operations that carry a machine as text only to the matching machine. Safe to run repeatedly."
              onClick={() => backfillMut.mutate()}
            >
              {backfillMut.isPending
                ? 'Linking…'
                : backfillMut.isSuccess
                  ? `Linked ${backfillMut.data.updated} op(s) ✓`
                  : 'Link machine codes'}
            </button>
          ) : null}
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
            <div className="panel-hdr" style={{ background: 'var(--bg4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                <span className="mono fw-700" style={{ fontSize: 15 }}>
                  {m.machineCode}
                </span>
                <span className="text2" style={{ fontSize: 12 }}>
                  {m.machineName ?? ''}
                </span>
                <span className="mono text3" style={{ fontSize: 11 }}>
                  {m.pendingHrs}h pending
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                <span className="mono amber" style={{ fontSize: 11 }}>
                  {m.pendingCount} jobs
                </span>
              </div>
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
                      <th style={{ width: 44 }}>Order</th>
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
                        Avail★
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
                            isNext ? { background: 'rgba(255,176,32,0.04)' } : undefined
                          }
                        >
                          <td style={{ width: 44, textAlign: 'center' }}>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                alignItems: 'center',
                              }}
                            >
                              {canWrite && idx > 0 ? (
                                <button
                                  type="button"
                                  style={queueBtnStyle}
                                  onClick={() => onMove(m.machineId, r.jcOpId, 'up')}
                                  title="Move up"
                                >
                                  ▲
                                </button>
                              ) : (
                                <span style={{ width: 18, display: 'inline-block' }} />
                              )}
                              {canWrite && idx < m.rows.length - 1 ? (
                                <button
                                  type="button"
                                  style={queueBtnStyle}
                                  onClick={() => onMove(m.machineId, r.jcOpId, 'down')}
                                  title="Move down"
                                >
                                  ▼
                                </button>
                              ) : (
                                <span style={{ width: 18, display: 'inline-block' }} />
                              )}
                            </div>
                          </td>
                          <td
                            className="td-ctr mono fw-700"
                            style={{ color: isNext ? 'var(--amber)' : 'var(--text3)', width: 28 }}
                          >
                            {idx + 1}
                          </td>
                          <td className="td-code cyan" style={{ whiteSpace: 'nowrap' }}>
                            <Link
                              to="/job-cards/$id"
                              params={{ id: r.jcId }}
                              style={{ color: 'inherit', textDecoration: 'underline dotted' }}
                            >
                              {r.jcCode}
                            </Link>
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
                            <PriorityBadge priority={r.priority} />
                          </td>
                          <td className="text2 td-ctr" style={{ fontSize: 11 }}>
                            {r.dueDate ?? '—'}
                          </td>
                          <td className="td-ctr mono">{r.orderQty}</td>
                          <td className="td-ctr green mono fw-700">{r.completed}</td>
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
                                  background: 'var(--green3)',
                                  border: '1px solid var(--green2)',
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

// Legacy badge() (HTML L1959) mapped onto our lowercase computed_status enum.
// Legacy's `In Progress`/`At Vendor` map to .b-yellow, which legacy defines ONLY
// in its print-only <style> block (L10559) — so on legacy's screen they render as
// a bare .badge. We reproduce that with no b-* class rather than invent a tint.
const OP_STATUS: Record<string, { label: string; cls: string }> = {
  complete: { label: 'Complete', cls: 'b-green' },
  in_progress: { label: 'In Progress', cls: '' },
  available: { label: 'Available', cls: 'b-blue' },
  waiting: { label: 'Waiting', cls: 'b-red' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
  running: { label: 'Running', cls: '' },
  ready_for_pr: { label: 'Ready for PR', cls: 'b-amber' },
  pr_raised: { label: 'PR Raised', cls: 'b-amber' },
  po_created: { label: 'PO Created', cls: 'b-blue' },
  at_vendor: { label: 'Processing', cls: '' },
  received: { label: 'Incoming QC', cls: 'b-cyan' },
  outsource: { label: 'Outsource', cls: 'b-amber' },
};

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const hit = OP_STATUS[status.toLowerCase()];
  // Legacy: `m[status] || 'b-grey'`.
  const cls = hit ? hit.cls : 'b-grey';
  return (
    <span className={cls ? `badge ${cls}` : 'badge'}>
      {hit ? hit.label : status.replace(/_/g, ' ')}
    </span>
  );
}

// Legacy badge() (L1959): 'High' → b-amber, 'Normal' → b-grey.
function PriorityBadge({ priority }: { priority: string }): React.JSX.Element {
  const high = priority.toLowerCase() === 'high';
  return (
    <span className={`badge ${high ? 'b-amber' : 'b-grey'}`}>{high ? 'High' : 'Normal'}</span>
  );
}
