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
import { opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDateAndTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useMachinesList } from '@/modules/machines/api';
import { useJcOpsEnriched, useRealtimeRunningOps, useRunningOps } from '../api';
import { MachineCard } from './machine-card';
import { OpEntryModal, type OpEntryModalTarget } from './op-entry-modal';
import { PendingOpsSection, type MadeHereRow } from './pending-ops-section';

export function MachineOpEntryView({
  initialMachineId = null,
}: {
  /** Machine to open on (the Machine detail page's "Op Entry" link). */
  initialMachineId?: string | null;
} = {}): React.JSX.Element {
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(initialMachineId);
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
  const selectedRunning = selectedMachineId
    ? (runningByMachine.get(selectedMachineId) ?? null)
    : null;
  // `CODE/REV` for the part on the selected machine right now — '' when nothing
  // is running there or the running-op join brought no item back. Tested rather
  // than printed blind so the ITEM tile can be left out entirely instead of
  // standing on the card as an empty bordered box.
  const runningItemCode = selectedRunning
    ? itemCodeWithRev(selectedRunning.itemCode, selectedRunning.itemRevision, '')
    : '';

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
          <div
            style={{
              background: 'var(--bg3)',
              border: '2px solid var(--green)',
              borderRadius: 10,
              padding: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cyan)' }}>
                {selectedMachine.code} — <span style={{ color: 'var(--green2)' }}>🟢 Running</span>
              </div>
              <div className="text3" style={{ fontSize: 11 }}>
                Started: {fmtDateAndTime(selectedRunning.startDate, selectedRunning.startTime)} by{' '}
                {selectedRunning.operatorName ?? ''}
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
              <div
                style={{
                  background: 'var(--bg)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                <div className="text3" style={{ fontSize: 11 }}>
                  JC No.
                </div>
                <div className="mono fw-700 cyan">{selectedRunning.jobCardCode}</div>
              </div>
              {/* WHAT IS ON THE MACHINE. The tile beside it names the job and the
                  one after it names the operation, and until now nothing on this
                  card named the part — so "CNC-1 is running IN-JC-26-00017 Op 1"
                  still left the supervisor to look up which component that is.
                  A fourth tile rather than a second line in the JOB CARD tile,
                  because the code and the name are one fact and they need the
                  width of their own track; auto-fit at minmax(120px, 1fr) keeps
                  all four on one row on a shop-floor monitor and drops them to
                  two rows on a tablet on its own. */}
              {runningItemCode || selectedRunning.itemName ? (
                <div
                  style={{
                    background: 'var(--bg)',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="text3" style={{ fontSize: 11 }}>
                    Item Code
                  </div>
                  {/* POL — the line number printed on the CUSTOMER's own
                      purchase order, immediately before the item code. Dropped
                      when no sales order sits behind the card, so a job-work
                      job reads exactly as this tile always has. */}
                  {selectedRunning.clientPoLineNo ? (
                    <div className="mono text3" style={{ fontSize: 11 }}>
                      POL{' '}
                      <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                        {selectedRunning.clientPoLineNo}
                      </span>
                    </div>
                  ) : null}
                  <div className="mono fw-700" style={{ color: 'var(--purple)' }}>
                    {runningItemCode}
                  </div>
                  {/* Clipped to the tile with the full name on hover — a
                      free-text part name is the one value here that can run
                      long, and letting it wrap would push AVAILABLE off the
                      row. */}
                  {selectedRunning.itemName ? (
                    <div
                      className="text3"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={selectedRunning.itemName}
                    >
                      {selectedRunning.itemName}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div
                style={{
                  background: 'var(--bg)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                <div className="text3" style={{ fontSize: 11 }}>
                  Operation
                </div>
                <div className="fw-700">
                  Op {opSrNo(runningOpRow.opSeq)}: {runningOpRow.operation}
                </div>
              </div>
              <div
                style={{
                  background: 'var(--bg)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                }}
              >
                <div className="text3" style={{ fontSize: 11 }}>
                  Available
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
                  ✓ Complete / ■ Stop
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
            // The tile the operator is standing at pre-fills the Actual
            // Machine picker; the op's planned machine is shown beside it.
            onStart={(op) =>
              setEntryTarget({
                op,
                activeRunningId: op.activeRunningOpId,
                mode: 'start',
                machineId: selectedMachine.id,
              })
            }
          />
        )
      ) : (
        <div
          style={{ background: 'var(--bg3)', borderRadius: 10, padding: 30, textAlign: 'center' }}
        >
          <div className="empty-icon" style={{ fontSize: 24 }}>
            ⬅
          </div>
          <div className="text3" style={{ fontSize: 14 }}>
            Select a machine.
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
