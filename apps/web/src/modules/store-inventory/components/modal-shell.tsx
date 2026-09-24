// The Store screens' overlay box. Lifted out of routes/list.tsx unchanged so
// the reservation drill-down can use the very same shell as ± Adjust, Min Qty
// and Manual Receipt — one box, not a second hand-rolled one.

export function ModalShell({
  onClose,
  title,
  children,
  width = 'min(1100px, 96vw)',
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Override only when the content genuinely needs a different box. */
  width?: string;
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
          width,
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
