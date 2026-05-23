import type { JcOpEnriched, RunningOp } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Play } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { useMachinesList } from '@/modules/machines/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJcOpsEnriched, useRealtimeRunningOps, useRunningOps, useStartOp } from '../api';
import { MachineCard } from '../components/machine-card';
import { OpEntryForm } from '../components/op-entry-form';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
});

export const machineOpEntryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry/machines',
  validateSearch: searchSchema,
  component: MachineOpEntryPage,
});

function MachineOpEntryPage() {
  const search = machineOpEntryRoute.useSearch();
  const navigate = machineOpEntryRoute.useNavigate();

  useRealtimeRunningOps();
  const machines = useMachinesList({ limit: 200, offset: 0 });
  const running = useRunningOps({ status: 'running' });

  const selectedMachineId = search.m ?? null;
  const selectedMachine = useMemo(
    () => machines.data?.machines.find((m) => m.id === selectedMachineId) ?? null,
    [machines.data, selectedMachineId],
  );
  const runningByMachine = useMemo(() => {
    const map = new Map<string, RunningOp>();
    for (const r of running.data ?? []) {
      if (r.machineId && r.status === 'running' && !r.isOsp) map.set(r.machineId, r);
    }
    return map;
  }, [running.data]);
  const selectedRunning = selectedMachineId
    ? (runningByMachine.get(selectedMachineId) ?? null)
    : null;

  // Pending ops for the selected machine when idle. Fetch all jc_ops for the
  // machine, filter client-side to "available" + "waiting" (the legacy
  // pickable subset, line 5625-5627).
  const machineOps = useJcOpsEnriched(
    selectedMachineId && !selectedRunning ? { machineId: selectedMachineId } : { machineId: '' },
    { enabled: Boolean(selectedMachineId && !selectedRunning) },
  );
  const pendingOps = useMemo<JcOpEnriched[]>(
    () =>
      (machineOps.data ?? []).filter(
        (o) =>
          o.available > 0 && (o.computedStatus === 'available' || o.computedStatus === 'waiting'),
      ),
    [machineOps.data],
  );

  // For the running case, fetch the single running op enriched (so the form
  // has fresh availability + status).
  const runningOpEnriched = useJcOpsEnriched(
    selectedRunning ? { jobCardCode: selectedRunning.jobCardCode } : { jobCardCode: '' },
    { enabled: Boolean(selectedRunning) },
  );
  const runningOpRow = useMemo<JcOpEnriched | null>(() => {
    if (!selectedRunning || !runningOpEnriched.data) return null;
    return runningOpEnriched.data.find((o) => o.id === selectedRunning.jcOpId) ?? null;
  }, [selectedRunning, runningOpEnriched.data]);

  function selectMachine(id: string | null) {
    void navigate({
      search: () => (id ? { m: id } : {}),
      replace: true,
    });
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
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Machine Op Entry
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Pick a machine to log work; running machines show the active session.
          </div>
        </div>
        <Link to="/op-entry" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> JC-wise entry
        </Link>
      </div>

      {machines.isLoading ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machines…
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 10,
            marginBottom: 16,
          }}
        >
          {(machines.data?.machines ?? []).map((m) => (
            <MachineCard
              key={m.id}
              machine={m}
              running={runningByMachine.get(m.id) ?? null}
              isSelected={m.id === selectedMachineId}
              onSelect={() => selectMachine(m.id === selectedMachineId ? null : m.id)}
            />
          ))}
        </div>
      )}

      {selectedMachine ? (
        selectedRunning && runningOpRow ? (
          <div>
            <div style={{ marginBottom: 8 }}>
              <span className="mono fw-700" style={{ fontSize: 15 }}>
                {selectedMachine.code}
              </span>{' '}
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>● Running</span>
            </div>
            <OpEntryForm op={runningOpRow} activeRunningId={selectedRunning.id} />
          </div>
        ) : selectedRunning ? (
          <div className="text3" style={{ fontSize: 13 }}>
            Loading running op…
          </div>
        ) : (
          <PendingOpsSection
            machineCode={selectedMachine.code}
            ops={pendingOps}
            isLoading={machineOps.isLoading}
          />
        )
      ) : (
        <div className="panel">
          <div className="empty-state">
            Select a machine above to view its session or pending jobs.
          </div>
        </div>
      )}
    </div>
  );
}

interface PendingOpsSectionProps {
  machineCode: string;
  ops: JcOpEnriched[];
  isLoading: boolean;
}

function PendingOpsSection({ machineCode, ops, isLoading }: PendingOpsSectionProps) {
  const start = useStartOp();
  function handleStart(opId: string) {
    void start.mutateAsync({
      jcOpId: opId,
      startDate: new Date().toISOString().slice(0, 10),
      startTime: new Date().toTimeString().slice(0, 5),
      shift: 'day',
    });
  }
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">
          <span className="mono fw-700">{machineCode}</span> —{' '}
          <span className="text3">○ Idle</span>
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>JC</th>
              <th>Op</th>
              <th>Operation</th>
              <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Available</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading pending jobs…
                </td>
              </tr>
            ) : ops.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No pending jobs assigned to this machine.
                </td>
              </tr>
            ) : (
              ops.map((op) => (
                <tr key={op.id}>
                  <td className="td-code cyan">{op.jobCardCode}</td>
                  <td className="mono">{op.opSeq}</td>
                  <td>{op.operation}</td>
                  <td className="td-ctr mono fw-700 amber">{op.available}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleStart(op.id)}
                      disabled={start.isPending}
                    >
                      <Play size={13} /> Start
                    </button>
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
