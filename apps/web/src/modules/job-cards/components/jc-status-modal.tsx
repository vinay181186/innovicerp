// JC Status modal — overlay matching legacy viewJCStatus (showModalLg). Opened
// from the Job Cards list (JC No. / 👁 View). Body is the shared JcStatusContent.
import { JcStatusContent } from './jc-status-content';

export function JcStatusModal({
  id,
  code,
  onClose,
}: {
  id: string;
  code: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="overlay" style={{ alignItems: 'flex-start' }} onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">JC Status — {code}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <JcStatusContent id={id} />
        </div>
      </div>
    </div>
  );
}
