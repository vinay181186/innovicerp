// Machine Op Entry — folded in as the "By Machine" view of Op Entry (formerly the
// standalone /op-entry/machines route). Pick a machine → see its running op or
// its pending jobs, and press an action on the ROW you mean. Uses local
// component state for the selected machine (the standalone route drove it off the
// URL). Reuses the same start-op / op-entry-form write path.
//
// WHY THERE ARE NO ENTRY FIELDS ON THIS SCREEN ANY MORE. The Date / Time /
// Shift / Operator boxes used to sit in ONE strip above the pending-jobs table.
// That strip belonged to whichever row you eventually pressed ▶ Start on, and
// which row that was is not something the screen could show. On 10-Sep an
// operator meant to book against IN-JC-26-00017 Op 1 and booked against
// IN-JC-26-00005 Op 1 instead — JC 0005 is the first row, JC 0017 the fourth.
// Every field now lives inside `OpEntryModal`, which is opened FROM a row and
// states that row's job card, operation and machine above the first field. One
// popup exists at a time, and it was opened from the operation it belongs to,
// so there is no longer a way to type into a form meant for a different job.

import { type JcOpEnriched, type RunningOp } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useMachinesList } from '@/modules/machines/api';
import { useJcOpsEnriched, useRealtimeRunningOps, useRunningOps } from '../api';
import { MachineCard } from './machine-card';
import { OpEntryModal, type OpEntryModalTarget } from './op-entry-modal';

export function MachineOpEntryView(): React.JSX.Element {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  // THE one open popup for this whole view — both the running-machine card and
  // every pending row set this same piece of state. Deliberately one, not one
  // modal per row: a modal per row is a form per row again, which is the bug
  // this screen was rebuilt to remove.
  const [entryTarget, setEntryTarget] = useState<OpEntryModalTarget | null>(null);

  useRealtimeRunningOps();
  const machines = useMachinesList({ limit: 200, offset: 0 });
  const running = useRunningOps({ status: 'running' });

  // Logging or stopping shop-floor work is op_entry entry (Production) — the
  // same right the inline entry form used to check for itself. It is checked
  // here now because the buttons that open the form live here.
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;

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
  // PENDING = work that still RUNS here. The endpoint also returns ops this
  // machine merely PRODUCED on (ADR-125/126: past production keeps its own
  // machine, the op's machine moves with the remaining qty), so the assigned-
  // to-this-machine test below is load-bearing — without it a re-routed op
  // would offer a ▶ Start on the machine it no longer runs on and production
  // would be logged against the wrong machine.
  //
  // This list used to also demand computedStatus 'available' or 'waiting', and
  // that quietly hid half the shop floor's work. computedStatus answers a
  // QUANTITY question — is there anything left here — and it flips to
  // 'in_progress' the moment the FIRST piece is booked and stays there for the
  // rest of the op's life. So an operation that had produced 30 of 100 pcs
  // dropped off its own machine's pending list with 70 pcs still owed and no
  // way back to it. On live data CNC-1 had 5 operations with work left and
  // showed 1: four of them, 187 pcs, were invisible, including
  // IN-JC-26-00017 Op 1 with 70 of 100 pcs still to run.
  //
  // The two questions that actually decide whether a ▶ Start belongs here are:
  // is somebody running this op right now (activeRunningOpId — the session
  // question, which computedStatus cannot answer), and is it blocked waiting
  // on QC. Nothing else.
  const pendingOps = useMemo<JcOpEnriched[]>(() => {
    const code = selectedMachine?.code;
    if (!code) return [];
    return (machineOps.data ?? []).filter(
      (o) =>
        o.available > 0 &&
        o.activeRunningOpId === null && // not being run right now by anybody
        o.computedStatus !== 'qc_pending' && // blocked waiting on QC, not startable
        (o.machineCode === code || o.machineCodeText === code),
    );
  }, [machineOps.data, selectedMachine]);

  // MADE HERE = the honest per-machine history. An op can appear in BOTH lists
  // (still running here AND has already made pieces here) — that is correct,
  // so the two lists are deliberately not de-duplicated. The qty shown is the
  // breakdown entry's qty, never the op's total completedQty, which may span
  // several machines and would overstate what this machine did.
  const producedOps = useMemo<MadeHereRow[]>(() => {
    const code = selectedMachine?.code;
    if (!code) return [];
    const rows: MadeHereRow[] = [];
    for (const o of machineOps.data ?? []) {
      const entry = o.machines.find((m) => m.machineCode === code);
      if (entry && entry.qty > 0) rows.push({ op: o, qty: entry.qty });
    }
    return rows;
  }, [machineOps.data, selectedMachine]);

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
            {/* The entry form used to sit open right here. It is now behind these
                two buttons so that every entry on this screen — running machine
                or pending row — is made in the same popup, headed by the job it
                belongs to. Both open the SAME popup on the SAME running session:
                Stop needs the quantity boxes just as much as Log does (the
                session's output is stated when it is closed), and the form shows
                its own Stop button whenever a session is open, which is why both
                buttons ask for 'complete'. */}
            {canOpEntry ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() =>
                    setEntryTarget({
                      op: runningOpRow,
                      activeRunningId: selectedRunning.id,
                      mode: 'complete',
                    })
                  }
                >
                  ✚ Log
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Books the quantity you enter AND frees the machine for the next job"
                  onClick={() =>
                    setEntryTarget({
                      op: runningOpRow,
                      activeRunningId: selectedRunning.id,
                      mode: 'complete',
                    })
                  }
                >
                  ■ Stop
                </button>
              </div>
            ) : null}
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
            producedOps={producedOps}
            isLoading={machineOps.isLoading}
            onStart={(op) =>
              setEntryTarget({ op, activeRunningId: op.activeRunningOpId, mode: 'start' })
            }
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

      {/* Rendered ONCE for the whole view, never once per row. The popup closes
          itself on a successful save (it hands OpEntryForm its onSubmitted), so
          clearing the target here is only for the ✕ / overlay click. */}
      {entryTarget ? (
        <OpEntryModal target={entryTarget} onClose={() => setEntryTarget(null)} />
      ) : null}
    </div>
  );
}

/** One op that this machine actually produced on, with THAT machine's share of
 *  the completed qty pulled out of the op's per-machine breakdown. */
interface MadeHereRow {
  op: JcOpEnriched;
  qty: number;
}

interface PendingOpsSectionProps {
  machineCode: string;
  machineName: string;
  ops: JcOpEnriched[];
  producedOps: MadeHereRow[];
  isLoading: boolean;
  /** Asks the view to open the entry popup for THIS row. The section holds no
   *  entry state of its own any more — that is the whole point. */
  onStart: (op: JcOpEnriched) => void;
}

function PendingOpsSection({
  machineCode,
  machineName,
  ops,
  producedOps,
  isLoading,
  onStart,
}: PendingOpsSectionProps) {
  // Starting a session records shop-floor work → op_entry entry (Production).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
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
          <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
            Press ▶ Start on the row you are booking against — the date, time, shift and
            operator are asked for inside, under that job card's own heading.
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
                    {/* Job card, op number and operation name are all set bold:
                        picking the wrong row is the exact mistake this screen
                        was rebuilt around, so the three things that identify a
                        row have to be readable at a glance rather than the
                        code alone standing out. */}
                    <td className="mono fw-700 cyan">{op.jobCardCode}</td>
                    <td className="mono fw-700">Op {op.opSeq}</td>
                    <td className="fw-700">{op.operation}</td>
                    <td className="mono fw-700 amber">{op.available}</td>
                    <td>
                      {canOpEntry ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onStart(op)}
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
          No pending jobs for this machine. Every operation assigned to {machineCode} is either
          complete, still waiting for input from the previous operation, already running on
          another session, or held up in QC.
        </div>
      )}
      {/* MADE ON THIS MACHINE — history, not work. An op lands here because the
          per-machine breakdown says this machine produced pieces on it, even if
          the op has since been re-routed elsewhere. Informational only: no
          Start / entry buttons, because you cannot log production against an
          operation that no longer runs here. */}
      {!isLoading && producedOps.length > 0 ? (
        <>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green)',
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Made on this Machine ({producedOps.length})
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC No.</th>
                  <th>Op</th>
                  <th>Operation</th>
                  <th style={{ color: 'var(--green)' }}>Qty Made Here</th>
                </tr>
              </thead>
              <tbody>
                {producedOps.map((row) => (
                  <tr key={row.op.id}>
                    <td className="mono fw-700 cyan">{row.op.jobCardCode}</td>
                    <td className="mono">Op{row.op.opSeq}</td>
                    <td>{row.op.operation}</td>
                    <td className="mono fw-700 green">{row.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {!isLoading && producedOps.length === 0 ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 12 }}>
          No production has been recorded on {machineCode} yet.
        </div>
      ) : null}
    </div>
  );
}
