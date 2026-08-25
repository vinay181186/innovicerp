// Machine Op Entry — folded in as the "By Machine" view of Op Entry (formerly the
// standalone /op-entry/machines route). Pick a machine → see its running op (with
// the log-entry form) or its pending jobs (with a quick ▶ Start). Uses local
// component state for the selected machine (the standalone route drove it off the
// URL). Reuses the same start-op / op-entry-form write path.

import { type JcOpEnriched, type RunningOp, SHIFTS, SHIFT_LABELS, type Shift } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useMachinesList } from '@/modules/machines/api';
import { useJcOpsEnriched, useRealtimeRunningOps, useRunningOps, useStartOp } from '../api';
import { MachineCard } from './machine-card';
import { OpEntryForm } from './op-entry-form';

export function MachineOpEntryView(): React.JSX.Element {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);

  useRealtimeRunningOps();
  const machines = useMachinesList({ limit: 200, offset: 0 });
  const running = useRunningOps({ status: 'running' });

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
  const selectedRunning = selectedMachineId ? (runningByMachine.get(selectedMachineId) ?? null) : null;

  const machineOps = useJcOpsEnriched(
    selectedMachineId && !selectedRunning ? { machineId: selectedMachineId } : { machineId: '' },
    { enabled: Boolean(selectedMachineId && !selectedRunning) },
  );
  const pendingOps = useMemo<JcOpEnriched[]>(
    () =>
      (machineOps.data ?? []).filter(
        (o) => o.available > 0 && (o.computedStatus === 'available' || o.computedStatus === 'waiting'),
      ),
    [machineOps.data],
  );

  const runningOpEnriched = useJcOpsEnriched(
    selectedRunning ? { jobCardCode: selectedRunning.jobCardCode } : { jobCardCode: '' },
    { enabled: Boolean(selectedRunning) },
  );
  const runningOpRow = useMemo<JcOpEnriched | null>(() => {
    if (!selectedRunning || !runningOpEnriched.data) return null;
    return runningOpEnriched.data.find((o) => o.id === selectedRunning.jcOpId) ?? null;
  }, [selectedRunning, runningOpEnriched.data]);

  return (
    <div>
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
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
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
              onSelect={() => setSelectedMachineId(m.id === selectedMachineId ? null : m.id)}
            />
          ))}
        </div>
      )}

      {selectedMachine ? (
        selectedRunning && runningOpRow ? (
          <div style={{ background: 'var(--bg3)', border: '2px solid var(--green)', borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cyan)' }}>
                {selectedMachine.code} — <span style={{ color: 'var(--green)' }}>🟢 Running</span>
              </div>
              <div className="text3" style={{ fontSize: 11 }}>
                Started: {selectedRunning.startTime} by {selectedRunning.operatorName ?? ''}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="text3" style={{ fontSize: 9 }}>
                  JOB CARD
                </div>
                <div className="mono fw-700 cyan">{selectedRunning.jobCardCode}</div>
              </div>
              <div style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="text3" style={{ fontSize: 9 }}>
                  OPERATION
                </div>
                <div className="fw-700">
                  Op{runningOpRow.opSeq}: {runningOpRow.operation}
                </div>
              </div>
              <div style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <div className="text3" style={{ fontSize: 9 }}>
                  AVAILABLE
                </div>
                <div className="mono fw-700 amber" style={{ fontSize: 18 }}>
                  {runningOpRow.available}
                </div>
              </div>
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
            machineName={selectedMachine.name}
            ops={pendingOps}
            isLoading={machineOps.isLoading}
          />
        )
      ) : (
        <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 30, textAlign: 'center' }}>
          <div className="empty-icon" style={{ fontSize: 24 }}>
            ⬅
          </div>
          <div className="text3" style={{ fontSize: 14 }}>
            Select a machine from above to view status and enter production data
          </div>
        </div>
      )}
    </div>
  );
}

interface PendingOpsSectionProps {
  machineCode: string;
  machineName: string;
  ops: JcOpEnriched[];
  isLoading: boolean;
}

function PendingOpsSection({ machineCode, machineName, ops, isLoading }: PendingOpsSectionProps) {
  const start = useStartOp();
  // Starting a session records shop-floor work → op_entry entry (Production).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const [startDate, setStartDate] = useState(todayLocal());
  const [startTime, setStartTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [shift, setShift] = useState<Shift>('day');
  function handleStart(opId: string) {
    void start.mutateAsync({ jcOpId: opId, startDate, startTime, shift });
  }
  return (
    <div style={{ background: 'var(--bg3)', border: '2px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cyan)', marginBottom: 4 }}>
        {machineCode} — <span className="text3">⚪ Idle</span>
      </div>
      <div className="text3" style={{ fontSize: 12, marginBottom: 14 }}>
        {machineName}
      </div>
      {isLoading ? (
        <div className="empty-state" style={{ padding: 20 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading pending jobs…
        </div>
      ) : ops.length > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber)', marginBottom: 8 }}>
            Pending Jobs for this Machine ({ops.length})
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="form-grp" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mach-start-date">
                Start Date
              </label>
              <input
                id="mach-start-date"
                className="innovic-input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mach-start-time">
                Start Time
              </label>
              <input
                id="mach-start-time"
                className="innovic-input"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="mach-start-shift">
                Shift
              </label>
              <select
                id="mach-start-shift"
                className="innovic-select"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC No.</th>
                  <th>Op</th>
                  <th>Operation</th>
                  <th style={{ color: 'var(--amber)' }}>Avail</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ops.map((op) => (
                  <tr key={op.id}>
                    <td className="mono fw-700 cyan">{op.jobCardCode}</td>
                    <td className="mono">Op{op.opSeq}</td>
                    <td>{op.operation}</td>
                    <td className="td-ctr mono fw-700 amber">{op.available}</td>
                    <td>
                      {canOpEntry ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleStart(op.id)}
                          disabled={start.isPending}
                        >
                          ▶ Start
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="empty-state" style={{ padding: 20 }}>
          No pending jobs for this machine. All operations assigned to {machineCode} are either
          complete or waiting for input.
        </div>
      )}
    </div>
  );
}
