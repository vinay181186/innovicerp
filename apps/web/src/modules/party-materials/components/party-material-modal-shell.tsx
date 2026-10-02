// Shared modal chrome for the Customer Material Add / Edit dialogs.
// Split out of routes/list.tsx (ADR-199 table-standard conversion, 2026-10-01)
// so the list page stays under the 400-line ceiling and both modals reuse one
// copy of the shell, the action row, the field label and the error box.

import { Loader2 } from 'lucide-react';

export function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
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
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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
    </div>
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
      <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
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
