// Machine card — legacy look via inline tokens (legacy `.mach-card`; the class
// itself isn't ported to the theme, so we use the legacy CSS variables).

import type { Machine, RunningOp } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';

interface Props {
  machine: Machine;
  running: RunningOp | null;
  isSelected: boolean;
  onSelect: () => void;
}

export function MachineCard({
  machine,
  running,
  isSelected,
  onSelect,
}: Props): React.JSX.Element {
  // `CODE/REV` for the part on this machine right now — '' when the machine is
  // idle, or when the running-op join brought no item back. Computed once here
  // because the tile uses it both as the visible line and inside its tooltip.
  const itemCode = running ? itemCodeWithRev(running.itemCode, running.itemRevision, '') : '';
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'block',
        width: '100%',
        minWidth: 130,
        border: `2px solid ${isSelected ? 'var(--cyan)' : 'var(--border)'}`,
        borderRadius: 10,
        background: isSelected ? 'var(--cyan3)' : 'var(--bg3)',
        padding: 12,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all .15s',
      }}
    >
      <div className="mono cyan" style={{ fontWeight: 800, fontSize: 14 }}>
        {machine.code}
      </div>
      <div className="text3" style={{ fontSize: 10, marginBottom: 6 }}>
        {machine.name}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: running ? 'var(--green)' : 'var(--text3)',
        }}
      >
        {running ? '🟢 Running' : '⚪ Idle'}
      </div>
      {running ? (
        <>
          <div className="mono text2" style={{ fontSize: 11, marginTop: 3 }}>
            {running.jobCardCode}
          </div>
          {/* The part, as its CODE only. These tiles pack the whole shop onto
              one grid at a 140px track, and a free-text part name at that width
              would be ellipsis with two letters in front of it — worse than
              nothing, because it looks like information. `CODE/REV` is short and
              fixed-shape, so it fits, and the full name rides along in the
              tooltip for the one tile you are actually asking about. Without
              this the grid answered "CNC-1 is running IN-JC-26-00017" and left
              which component that is to be looked up elsewhere. */}
          {itemCode ? (
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--purple)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={running.itemName ? `${itemCode} — ${running.itemName}` : itemCode}
            >
              {itemCode}
            </div>
          ) : null}
          <div className="text3" style={{ fontSize: 10 }}>
            Op{running.opSeq}: {running.operation}
          </div>
        </>
      ) : null}
    </button>
  );
}
