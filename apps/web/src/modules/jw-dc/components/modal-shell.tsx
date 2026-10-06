// Shared modal bits for the JW DC create flows (split out of routes/list.tsx,
// ADR-199 table-standard conversion). ModalShell mirrors legacy showModalLg
// (L28032): .overlay > .modal.modal-lg with .modal-hdr / .modal-body /
// .modal-footer, guarded by the shared exit-confirm when dirty.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ExitConfirmDialog } from '@/lib/exit-guard';

export function ModalShell({
  onClose,
  title,
  onSave,
  saving,
  saveLabel,
  saveDisabled = false,
  dirty,
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
  /** Something was typed or ticked. Then a click on the grey backdrop, the ✕
   *  or Cancel asks "Are you sure you want to exit?" instead of throwing the
   *  popup away (the shared exit guard, lib/exit-guard.tsx). */
  dirty: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [askExit, setAskExit] = useState(false);
  const requestClose = (): void => {
    if (dirty) setAskExit(true);
    else onClose();
  };
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      {askExit ? (
        <ExitConfirmDialog
          onStay={() => setAskExit(false)}
          onExit={() => {
            setAskExit(false);
            onClose();
          }}
        />
      ) : null}
      <div className="modal modal-lg">
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={requestClose}>
            ✕
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {children}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={requestClose}>
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
        </div>
      </div>
    </div>
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
