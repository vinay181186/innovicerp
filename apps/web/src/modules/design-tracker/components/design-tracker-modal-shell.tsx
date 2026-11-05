// Shared modal chrome for the Design Tracker Add / Edit / Log-Time dialogs.
// Split out of routes/list.tsx (ADR-199 table standard, file-size ceiling).
// Unchanged behaviour — same ModalShell / Actions / Field / ErrorBox the three
// modals used when they lived in one file.

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

export function Actions({
  onClose,
  onSave,
  saving,
  label,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  label: string;
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
          label
        )}
      </button>
    </>
  );
}

export function Field({
  label,
  req,
  full,
  children,
}: {
  label: string;
  req?: boolean;
  full?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={full ? 'form-grp form-full' : 'form-grp'}>
      <label className="form-label">
        {label}
        {req ? <span className="req">★</span> : null}
      </label>
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
