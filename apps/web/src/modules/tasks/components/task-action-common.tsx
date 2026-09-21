// Shared bits of the task action popups: the task header strip and the
// Cancel / <action> footer.

import type { TaskRow } from '@innovic/shared';

export function TaskHead({ task }: { task: TaskRow }): React.JSX.Element {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: '8px 10px',
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <span className="mono fw-700" style={{ color: 'var(--blue)', marginRight: 8 }}>
        {task.code}
      </span>
      <b>{task.title}</b>
    </div>
  );
}

export function ActionFooter({
  onClose,
  onSubmit,
  busy,
  label,
  danger = false,
}: {
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  label: string;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
        Cancel
      </button>
      <button
        type="button"
        className={danger ? 'btn btn-danger' : 'btn btn-primary'}
        disabled={busy}
        onClick={onSubmit}
      >
        {busy ? 'Saving…' : label}
      </button>
    </>
  );
}
