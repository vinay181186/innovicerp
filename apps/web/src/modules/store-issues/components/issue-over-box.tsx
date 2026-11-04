// The "More than To Issue" box on New Item Issue (routes/create.tsx): the server
// answered 409 needsConfirmation, listing the lines over their To Issue. Going
// ahead needs a reason from an approve-tier user.

export interface OverLine {
  itemCode: string;
  toIssueQty: number;
  qty: number;
}

export function IssueOverBox({
  over,
  canApprove,
  reason,
  onReasonChange,
}: {
  over: OverLine[];
  canApprove: boolean;
  reason: string;
  onReasonChange: (reason: string) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 'var(--sp-3)',
        padding: 10,
        border: '1px solid var(--amber2)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div className="fw-700" style={{ fontSize: 'var(--fs-sm)', color: 'var(--amber2)' }}>
        More than To Issue
      </div>
      <ul style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 8px 16px' }}>
        {over.map((o) => (
          <li key={o.itemCode}>
            <span className="mono fw-700">{o.itemCode}</span>: Issue Qty {o.qty}, To Issue{' '}
            {o.toIssueQty}
          </li>
        ))}
      </ul>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 6 }}>
        {canApprove
          ? 'Issuing more needs a reason.'
          : 'Issuing more needs a Store user with approve rights — ask one to post this issue, or lower the qty.'}
      </div>
      <input
        type="text"
        className="innovic-input"
        disabled={!canApprove}
        placeholder="Reason, e.g. extra bar for a setup piece"
        value={reason}
        onChange={(e) => onReasonChange(e.target.value)}
      />
    </div>
  );
}
