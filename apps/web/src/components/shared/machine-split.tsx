// Per-machine production split — the shared renderers (ADR-126).
//
// A machine label sitting next to a completed qty implies that machine made all
// of it. After a mid-flight machine change (ADR-125) that is false: JC-93 op 1
// showed `CNC-03 … done 10` while the log held CNC-01 5 + CNC-02 5 and CNC-03
// had produced nothing.
//
// Both renderers deliberately return null when nothing disagrees with the
// machine label they sit beside, so the ordinary op — almost every op —
// renders byte-identical to before and only a genuinely split op gains any
// chrome. Callers can therefore drop these in unconditionally.
//
// "Disagrees" has two shapes (ADR-126, ADR-164): the qty was made on MORE
// THAN ONE machine, or on ONE machine that is not the one the label names.
// The second became ordinary once Start Operation let the operator run a job
// on a machine other than the planned one: `cnc-1 · done 7` with all 7 made
// on cnc-2 is the same lie as the multi-machine case, told with fewer rows.
// Callers that know the planned code pass it; those that do not keep the
// multi-machine rule alone.

import type { MachineSplit } from '@innovic/shared';

/** True when the split does not match the machine label it will sit beside:
 *  several machines, or one machine that is not `plannedCode`. Case-blind —
 *  the view returns the master's code, the label may be a text snapshot. */
export function splitDisagrees(machines: MachineSplit, plannedCode?: string | null): boolean {
  if (machines.length > 1) return true;
  const only = machines[0];
  if (!only || !plannedCode) return false;
  return only.machineCode.trim().toLowerCase() !== plannedCode.trim().toLowerCase();
}

// Formatting rule: ALWAYS separate the machine code from its qty and name the
// unit. "CNC-01 5" reads as one blob — the eye cannot tell where the machine
// name ends and the number begins, which is worse than no breakdown at all.
// Every surface (screen, tooltip, print, Excel, activity log) uses this shape.
export function formatMachineQty(machineCode: string, qty: number): string {
  return `${machineCode}: ${qty} pcs`;
}

/** Describes the split in one line, for a `title` tooltip. */
export function machineSplitTitle(machines: MachineSplit): string {
  const list = machines.map((m) => formatMachineQty(m.machineCode, m.qty)).join(' · ');
  return machines.length === 1
    ? `Produced on ${list} — not on the planned machine`
    : `Produced on ${machines.length} machines — ${list}`;
}

/** The `⚙N` marker that goes beside a MACHINE label, warning that the machine
 *  shown is where the REMAINING qty runs, not who made the completed qty. */
export function MachineChip({
  machines,
  plannedCode,
}: {
  machines: MachineSplit;
  /** The machine the label beside this chip names. With it, a single other
   *  machine also raises the chip; without it only a multi-machine split does. */
  plannedCode?: string | null;
}): React.JSX.Element | null {
  if (!splitDisagrees(machines, plannedCode)) return null;
  return (
    <span
      title={machineSplitTitle(machines)}
      style={{
        marginLeft: 4,
        fontSize: 9,
        fontWeight: 700,
        color: 'var(--amber)',
        cursor: 'help',
      }}
    >
      ⚙{machines.length > 1 ? machines.length : '≠'}
    </span>
  );
}

/** The per-machine breakdown that goes under a completed-QTY figure. */
export function MachineSplitLines({
  machines,
  plannedCode,
}: {
  machines: MachineSplit;
  /** See MachineChip. */
  plannedCode?: string | null;
}): React.JSX.Element | null {
  if (!splitDisagrees(machines, plannedCode)) return null;
  return (
    <>
      {machines.map((m) => (
        <div
          key={m.machineCode}
          style={{ fontSize: 9, fontWeight: 400, color: 'var(--text3)', whiteSpace: 'nowrap' }}
        >
          {m.machineCode}: <b style={{ fontWeight: 700 }}>{m.qty}</b> pcs
        </div>
      ))}
    </>
  );
}
