import type { Machine, RunningOp } from '@innovic/shared';

interface Props {
  machine: Machine;
  running: RunningOp | null;
  isSelected: boolean;
  onSelect: () => void;
}

export function MachineCard({ machine, running, isSelected, onSelect }: Props) {
  const accent = running ? 'border-green-500' : isSelected ? 'border-cyan-500' : 'border-border';
  const tone = running ? 'text-green-700 dark:text-green-300' : 'text-muted-foreground';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex min-w-[140px] flex-col items-start gap-1 rounded-lg border-2 ${accent} bg-card p-3 text-left transition-colors hover:bg-accent ${
        isSelected ? 'ring-2 ring-cyan-500/40' : ''
      }`}
    >
      <span className="font-mono text-sm font-bold text-primary">{machine.code}</span>
      <span className="text-[11px] text-muted-foreground">{machine.name}</span>
      <span className={`text-[11px] font-semibold ${tone}`}>
        {running ? '● Running' : '○ Idle'}
      </span>
      {running ? (
        <>
          <span className="font-mono text-[11px]">{running.jobCardCode}</span>
          <span className="text-[10px] text-muted-foreground">
            Op {running.opSeq}: {running.operation}
          </span>
        </>
      ) : null}
    </button>
  );
}
