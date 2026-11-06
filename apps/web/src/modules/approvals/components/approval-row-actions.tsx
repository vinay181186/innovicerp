// The visible ✓ / ✗ on one waiting row. While that row is being decided it
// shows "deciding…" and no buttons — the row locks the instant it is clicked,
// so it cannot be ticked twice.

import { Icon } from '@/ui/core';

export function ApprovalRowActions({
  busy,
  onApprove,
  onReject,
  rejectLabel = 'Reject',
}: {
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Tooltip of the ✗ — "Return to Creator" on a Route Card. */
  rejectLabel?: string | undefined;
}): React.JSX.Element {
  if (busy) {
    return (
      <span className="text3" style={{ fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>
        deciding…
      </span>
    );
  }
  return (
    <div
      style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="btn btn-sm btn-success"
        title="Approve"
        aria-label="Approve"
        onClick={onApprove}
      >
        <Icon name="check" size={14} />
      </button>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        title={rejectLabel}
        aria-label={rejectLabel}
        onClick={onReject}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
