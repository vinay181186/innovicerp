// Shared modal chrome for the Customer Material Add / Edit dialogs.
// Split out of routes/list.tsx (ADR-199 table-standard conversion, 2026-10-01)
// so the list page stays under the 400-line ceiling and both modals reuse one
// copy of the shell, the action row, the field label and the error box.

import { Loader2 } from 'lucide-react';
import { Modal } from '@/ui/feedback';

export function ModalShell({
  onClose,
  title,
  footer,
  children,
}: {
  onClose: () => void;
  title: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal title={title} onClose={onClose} footer={footer} maxWidth="min(1100px, 96vw)">
      {children}
    </Modal>
  );
}

export function ModalActions({
  onClose,
  onSave,
  saving,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
}): React.JSX.Element {
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          saveLabel
        )}
      </button>
    </>
  );
}

export function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 'var(--sp-1)' }}>
        {label}
        {required ? <span className="req">★</span> : null}
      </div>
      {children}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 'var(--sp-3)',
        padding: 'var(--sp-2)',
        background: 'var(--red3)',
        color: 'var(--red2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--fs-sm)',
      }}
    >
      {message}
    </div>
  );
}
