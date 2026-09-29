// Stock Count confirmation panels (ADR-193 phase 2).
import { STOCK_COUNT_REASON_MIN } from '@innovic/shared';

export interface ShortItem {
  itemCode: string;
  newInStock: number;
  booked: number;
}

/** Shown when the server answers "needs confirmation": the count would leave
 *  less on the shelf than is booked for customer SOs (paper test C9). */
export function ConfirmBelowBookedPanel(props: {
  short: ShortItem[];
  reason: string;
  setReason: (v: string) => void;
  busy: boolean;
  onPost: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { short, reason, setReason, busy, onPost, onBack } = props;
  return (
    <div className="panel" style={{ marginTop: 12, borderColor: 'var(--amber)' }}>
      <div className="panel-body">
        <div className="fw-700" style={{ marginBottom: 6 }}>
          These items will hold less than is booked for customer SOs:
        </div>
        <ul style={{ margin: '0 0 8px 18px' }}>
          {short.map((s) => (
            <li key={s.itemCode}>
              <span className="mono fw-700">{s.itemCode}</span> — In Stock after count{' '}
              {s.newInStock}, booked {s.booked}
            </li>
          ))}
        </ul>
        <input
          className="innovic-input"
          placeholder={`Reason to post anyway (at least ${STOCK_COUNT_REASON_MIN} characters)`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || reason.trim().length < STOCK_COUNT_REASON_MIN}
            onClick={onPost}
          >
            Post anyway
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export function CancelCountPanel(props: {
  reason: string;
  setReason: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { reason, setReason, busy, onCancel, onBack } = props;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-body" style={{ display: 'flex', gap: 8 }}>
        <input
          className="innovic-input"
          style={{ flex: 1 }}
          placeholder="Reason for cancelling"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onCancel}>
          Cancel count
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
