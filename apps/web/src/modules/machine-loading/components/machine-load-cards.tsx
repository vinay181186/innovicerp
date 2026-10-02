// Machine Loading — the machine card strip and the Capacity Summary table.
// Split out of routes/list.tsx (ADR-199) so that file stays under the 400-line
// ceiling. The cards are the page's own content (load bars, hours, days to
// clear); the Capacity Summary is a per-machine roll-up on the shared DataTable.

import type { MachineLoadCard, MachineLoadStatus } from '@innovic/shared';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';

// Legacy badge() (HTML L1959-1970) maps load status → colour:
// Overloaded→b-red · High Load→b-amber · Manageable→b-green · Clear→b-green.
export function loadBadgeClass(status: MachineLoadStatus): string {
  if (status === 'Overloaded') return 'b-red';
  if (status === 'High Load') return 'b-amber';
  return 'b-green'; // Manageable + Clear (legacy L1963)
}

function barColor(pct: number): string {
  if (pct > 100) return 'var(--red)';
  if (pct > 70) return 'var(--amber)';
  if (pct > 0) return 'var(--green)';
  return 'var(--bg5)';
}

// Legacy progBar() (L1972-1975) — .prog-wrap/.prog-bar are ported to our theme
// (innovic-theme.css L763/L769); only the width+colour are inline, as in legacy.
function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  return (
    <div className="prog-wrap">
      <div
        className="prog-bar"
        style={{ width: `${Math.min(100, pct)}%`, background: barColor(pct) }}
      />
    </div>
  );
}

function Num({ val, lbl, color }: { val: number; lbl: string; color?: string }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="mono fw-700" style={{ fontSize: 14, color: color ?? 'var(--text)' }}>
        {val}
      </div>
      <div className="text3" style={{ fontSize: 11 }}>
        {lbl}
      </div>
    </div>
  );
}

export function MachineLoadCardView({
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
    // Legacy .mach-card (L222) + .mach-card.sel (L223) inlined — neither is in
    // our theme. Selected state mirrors legacy's own intent: renderLoading emits
    // `.selected`, which legacy never defines (only `.sel`), so its selected card
    // gets no highlight; renderJobQueue (L10371) works around the same bug by
    // inlining the border/shadow. We keep the highlight.
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderColor: selected ? 'var(--cyan)' : 'var(--border)',
        boxShadow: selected ? '0 0 0 1px var(--cyan)' : undefined,
        borderRadius: 'var(--radius2)',
        padding: 14,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* Legacy .mach-id (L224) is not in our theme — inline approximation kept. */}
      <div className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 13 }}>
        {card.machineCode}
      </div>
      <div className="text3" style={{ fontSize: 11, marginBottom: 2 }}>
        {card.name}
      </div>
      <div className="text3 mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {card.machineType ?? '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Num val={card.totalAvailQty} lbl="Available" color="var(--amber)" />
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
        <span className="mono text3" style={{ fontSize: 11 }}>
          {pct}%
        </span>
        <span className={`badge ${loadBadgeClass(card.loadStatus)}`}>{card.loadStatus}</span>
      </div>
    </button>
  );
}

// The Capacity Summary roll-up. One row per machine, on the shared DataTable —
// no `tableKey`, so it keeps the ruled sheet look without a saved layout of its
// own (the screen's ONE fit layout belongs to the open-operations table). Labels
// per docs/NAMING.md; numbers right-aligned, text centred (ADR-199 alignment).
function capacityColumns(): DataTableColumn<MachineLoadCard>[] {
  return [
    {
      id: 'machine_code',
      header: 'Machine',
      className: 'td-code',
      nowrap: true,
      render: (m) => m.machineCode,
    },
    { id: 'machine_name', header: 'Name', align: 'left', ellipsis: true, render: (m) => m.name },
    {
      id: 'machine_type',
      header: 'Machine Type',
      className: 'text2',
      nowrap: true,
      render: (m) => m.machineType ?? '—',
    },
    {
      id: 'open_ops',
      header: 'Open Ops',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (m) => m.openOps,
    },
    {
      id: 'available',
      header: 'Available',
      align: 'right',
      headColor: 'var(--amber)',
      className: 'mono fw-700 amber',
      nowrap: true,
      render: (m) => m.totalAvailQty,
    },
    {
      id: 'pending_hrs',
      header: 'Pending Hrs',
      align: 'right',
      headColor: 'var(--red)',
      nowrap: true,
      render: (m) => (
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
          {m.pendingHrs}h
        </span>
      ),
    },
    {
      id: 'daily_cap',
      header: 'Daily Cap',
      align: 'right',
      className: 'mono green',
      nowrap: true,
      render: (m) => `${m.dailyCap}h`,
    },
    {
      id: 'days_to_clear',
      header: 'Days to Clear',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (m) => `${m.daysToClear}d`,
    },
    {
      id: 'loading_pct',
      header: 'Loading %',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (m) => `${Math.round(m.loadPct * 100)}%`,
    },
    {
      id: 'load_status',
      kind: 'badge',
      header: 'Load Status',
      nowrap: true,
      render: (m) => (
        <span className={`badge ${loadBadgeClass(m.loadStatus)}`}>{m.loadStatus}</span>
      ),
    },
  ];
}

/** The Capacity Summary tab's one table — a filled panel (ADR-202), so it must
 *  sit directly in the page's `page-fill` root. The tab names it, so no title. */
export function CapacitySummary({ machines }: { machines: MachineLoadCard[] }): React.JSX.Element {
  return (
    <Panel fill bodyPadding="none">
      <DataTable
        columns={capacityColumns()}
        rows={machines}
        rowKey={(m) => m.machineId}
        emptyText="No machines yet."
      />
    </Panel>
  );
}
