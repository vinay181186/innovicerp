// Machine card — legacy look via inline tokens (legacy `.mach-card`; the class
// itself isn't ported to the theme, so we use the legacy CSS variables).

import type { Machine, RunningOp } from '@innovic/shared';

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
  const accent = running ? 'var(--green)' : isSelected ? 'var(--cyan)' : 'var(--border2)';
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 3,
        minWidth: 140,
        border: `2px solid ${accent}`,
        borderRadius: 10,
        background: isSelected ? 'var(--bg4)' : 'var(--bg3)',
        padding: 12,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 13 }}>
        {machine.code}
      </span>
      <span className="text3" style={{ fontSize: 11 }}>
        {machine.name}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: running ? 'var(--green)' : 'var(--text3)',
        }}
      >
        {running ? '● Running' : '○ Idle'}
      </span>
      {running ? (
        <>
          <span className="mono" style={{ fontSize: 11 }}>
            {running.jobCardCode}
          </span>
          <span className="text3" style={{ fontSize: 10 }}>
            Op {running.opSeq}: {running.operation}
          </span>
        </>
      ) : null}
    </button>
  );
}
