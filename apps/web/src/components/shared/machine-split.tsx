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

// ── Planned / Actual pair (ADR-164) ─────────────────────────────────────────
//
// Every screen that names an operation's machine now names TWO: the PLANNED
// machine (jc_ops.machine_id, set at JC creation, where the remaining qty is
// routed) and the ACTUAL machine (the one the pieces were, or are being, made
// on). When the operator never changed it the two read the same name — that is
// the answer, not a gap, so both are always drawn. The actual is resolved in
// one place, in this order:
//   1. the machine of the OPEN running session (the pieces about to be logged
//      will be stamped with it);
//   2. the machine(s) that already made the completed qty (v_op_machine_output);
//   3. the plan itself — nothing has run yet, so nothing disagrees.

export interface MachineActual {
  /** The one code to print, or a "+" joined list when several machines made
   *  pieces (the breakdown then goes in `split`). */
  label: string;
  /** True when the actual is not the plan — the caller may colour it. */
  differs: boolean;
  /** Per-machine breakdown worth drawing under the label (2+ machines). */
  split: MachineSplit;
}

export function resolveActualMachine(input: {
  planned: string | null | undefined;
  activeRunningMachineCode?: string | null | undefined;
  machines?: MachineSplit | null | undefined;
}): MachineActual {
  const planned = (input.planned ?? '').trim();
  const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (input.activeRunningMachineCode) {
    const label = input.activeRunningMachineCode;
    return { label, differs: !eq(label, planned), split: [] };
  }
  const machines = input.machines ?? [];
  if (machines.length === 1) {
    const label = machines[0]!.machineCode;
    return { label, differs: !eq(label, planned), split: [] };
  }
  if (machines.length > 1) {
    return {
      label: machines.map((m) => m.machineCode).join(' + '),
      differs: true,
      split: machines,
    };
  }
  return { label: planned || '—', differs: false, split: [] };
}

// ── Two separate table columns: Planned Machine | Actual Machine ────────────
//
// The PLANNED / ACTUAL machine pair (ADR-164), split so a table gives each value
// its OWN column (one <td> each) instead of stacking both in one cell — the shop
// floor scans planned vs actual at a glance (ADR-179). Both reuse
// resolveActualMachine, so the amber "machine changed" cue and the multi-machine
// breakdown are consistent. (Replaced the old stacked PlannedActualMachine cell.)

/** Cell content for the PLANNED MACHINE column: just the planned code. */
export function PlannedMachineCell({
  planned,
  size = 11,
}: {
  planned: string | null | undefined;
  size?: number;
}): React.JSX.Element {
  return (
    <span className="mono fw-700" style={{ fontSize: size, whiteSpace: 'nowrap' }}>
      {planned?.trim() || '—'}
    </span>
  );
}

/** Cell content for the ACTUAL MACHINE column: the resolved actual code, amber
 *  when it differs from the plan, with the per-machine breakdown for 2+
 *  machines. Empty actual shows "—" (never blank). */
export function ActualMachineCell({
  planned,
  activeRunningMachineCode,
  machines,
  size = 11,
}: {
  planned: string | null | undefined;
  activeRunningMachineCode?: string | null | undefined;
  machines?: MachineSplit | null | undefined;
  size?: number;
}): React.JSX.Element {
  const actual = resolveActualMachine({ planned, activeRunningMachineCode, machines });
  return (
    <div style={{ lineHeight: 1.3 }}>
      <span
        className="mono fw-700"
        style={{
          fontSize: size,
          whiteSpace: 'nowrap',
          color: actual.differs ? 'var(--amber)' : undefined,
        }}
        title={actual.split.length ? machineSplitTitle(actual.split) : undefined}
      >
        {actual.label}
      </span>
      {actual.split.map((m) => (
        <div
          key={m.machineCode}
          style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap' }}
        >
          {m.machineCode}: <b>{m.qty}</b> pcs
        </div>
      ))}
    </div>
  );
}

/** The one-line "Actual: X" that goes under a Done figure on a screen where the
 *  op is already listed UNDER its planned machine (Machine Loading, Job Queue),
 *  so only the actual needs naming. Always drawn — the same name when nothing
 *  changed — amber when it differs, with the breakdown for 2+ machines. */
export function ActualMachineLine({
  planned,
  machines,
}: {
  planned: string | null;
  machines: MachineSplit;
}): React.JSX.Element {
  const actual = resolveActualMachine({ planned, machines });
  return (
    <>
      <div
        style={{
          fontSize: 9,
          fontWeight: 400,
          whiteSpace: 'nowrap',
          color: actual.differs ? 'var(--amber)' : 'var(--text3)',
        }}
      >
        Actual: <b style={{ fontWeight: 700 }}>{actual.label}</b>
      </div>
      {actual.split.map((m) => (
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
