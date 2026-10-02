// Design Project detail — shared presentational bits used by every tab and its
// modals. Split out of the (2083-line) detail.tsx under ADR-199 so no file
// crosses the 400-line ceiling. Behaviour and markup are unchanged.

import { Loader2 } from 'lucide-react';

/** Design Active / In Review = under way (amber); Released = done (green);
 *  On Hold = waiting (grey). Badge classes only. */
export function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const cls: Record<string, string> = {
    'Design Active': 'b-amber',
    'In Review': 'b-amber',
    Released: 'b-green',
    'On Hold': 'b-grey',
  };
  return <span className={`badge ${cls[status] ?? 'b-grey'}`}>{status}</span>;
}

/** Status / severity / priority badge — house badge classes, one colour per
 *  state (open blue, under way amber, done green, waiting grey, bad red). */
export function Badge({ value }: { value: string; kind?: 'status' }): React.JSX.Element {
  const v = value.toLowerCase().replace(/[\s/]/g, '');
  const cls: Record<string, string> = {
    critical: 'b-red',
    urgent: 'b-red',
    rejected: 'b-red',
    high: 'b-amber',
    major: 'b-amber',
    medium: 'b-amber',
    low: 'b-grey',
    minor: 'b-grey',
    normal: 'b-blue',
    open: 'b-blue',
    inprogress: 'b-amber',
    inreview: 'b-amber',
    underreview: 'b-amber',
    submitted: 'b-blue',
    designactive: 'b-amber',
    resolved: 'b-green',
    completed: 'b-green',
    released: 'b-green',
    accepted: 'b-green',
    approved: 'b-green',
    closed: 'b-green',
    notstarted: 'b-grey',
    onhold: 'b-grey',
    draft: 'b-grey',
  };
  return <span className={`badge ${cls[v] ?? 'b-grey'}`}>{value}</span>;
}

export function Modal({
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

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
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
