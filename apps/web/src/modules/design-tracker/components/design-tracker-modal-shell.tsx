// Shared modal chrome for the Design Tracker Add / Edit / Log-Time dialogs.
// Split out of routes/list.tsx (ADR-199 table standard, file-size ceiling).
// Unchanged behaviour — same ModalShell / Actions / Field / ErrorBox the three
// modals used when they lived in one file.

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
          label
        )}
      </button>
    </div>
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
        marginTop: 12,
        padding: 8,
        background: 'var(--red3)',
        color: 'var(--red2)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
