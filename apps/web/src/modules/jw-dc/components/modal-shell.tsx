// Shared modal bits for the JW DC create flows (split out of routes/list.tsx,
// ADR-199 table-standard conversion). ModalShell is the shared wide pop-up
// (ui/feedback/Modal) with the Cancel + Save footer both forms use.

import { Loader2 } from 'lucide-react';
import { Modal } from '@/ui/feedback';

export function ModalShell({
  onClose,
  title,
  onSave,
  saving,
  saveLabel,
  saveDisabled = false,
  children,
}: {
  onClose: () => void;
  title: string;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  /** Blocks Save for a reason the body already explains on screen (ADR-217
   *  phase 4: the "These are new pieces" tick is still unticked). Optional and
   *  false by default, so the New Inward modal is untouched. */
  saveDisabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal
      size="lg"
      title={title}
      onClose={onClose}
      bodyStyle={{ maxHeight: '75vh', overflowY: 'auto' }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || saveDisabled}
            onClick={onSave}
          >
            {saving ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              <>{saveLabel}</>
            )}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'rgba(239,68,68,0.08)',
        color: 'var(--red2)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
