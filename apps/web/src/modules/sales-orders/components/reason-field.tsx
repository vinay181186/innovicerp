// ADR-197 — the required "why" inside a Sales Order ConfirmDialog (Move to
// Trash, delete a line). Same textarea the PR delete dialog uses; the reason
// lands on the SO's History tab. The caller throws from onConfirm when it is
// blank, so the dialog shows the message and stays open.

export const REASON_REQUIRED_MESSAGE = 'Enter a reason — it is kept on the SO History.';

export function ReasonField(props: {
  value: string;
  onChange: (next: string) => void;
}): React.JSX.Element {
  return (
    <textarea
      className="innovic-input"
      aria-label="Reason"
      placeholder="Reason (required)"
      rows={2}
      maxLength={500}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      style={{ display: 'block', width: '100%', marginTop: 8 }}
    />
  );
}
