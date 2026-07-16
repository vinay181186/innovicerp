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
          <div className="text3" style={{ fontSize: 10 }}>
            Op{running.opSeq}: {running.operation}
          </div>
        </>
      ) : null}
    </button>
  );
}
