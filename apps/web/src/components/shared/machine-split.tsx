// Per-machine production split — the shared renderers (ADR-126).
//
// A machine label sitting next to a completed qty implies that machine made all
// of it. After a mid-flight machine change (ADR-125) that is false: JC-93 op 1
// showed `CNC-03 … done 10` while the log held CNC-01 5 + CNC-02 5 and CNC-03
// had produced nothing.
//
// Both renderers deliberately return null for 0 or 1 machines, so the ordinary
// never-re-routed op — almost every op — renders byte-identical to before and
// only a genuinely split op gains any chrome. Callers can therefore drop these
// in unconditionally without a length check of their own.

import type { MachineSplit } from '@innovic/shared';

/** Describes the split in one line, for a `title` tooltip. */
export function machineSplitTitle(machines: MachineSplit): string {
  return `Produced on ${machines.length} machines — ${machines
    .map((m) => `${m.machineCode} ${m.qty}`)
    .join(' · ')}`;
}

/** The `⚙N` marker that goes beside a MACHINE label, warning that the machine
 *  shown is where the REMAINING qty runs, not who made the completed qty. */
export function MachineChip({ machines }: { machines: MachineSplit }): React.JSX.Element | null {
  if (machines.length <= 1) return null;
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
      ⚙{machines.length}
    </span>
  );
}

/** The per-machine breakdown that goes under a completed-QTY figure. */
export function MachineSplitLines({
  machines,
}: {
  machines: MachineSplit;
}): React.JSX.Element | null {
  if (machines.length <= 1) return null;
  return (
    <>
      {machines.map((m) => (
        <div key={m.machineCode} style={{ fontSize: 9, fontWeight: 400, color: 'var(--text3)' }}>
          {m.machineCode} {m.qty}
        </div>
      ))}
    </>
  );
}
