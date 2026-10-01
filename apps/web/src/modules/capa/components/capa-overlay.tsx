// Modal shell shared by the CAPA New and 5-step Edit modals. Split out of
// capa-view.tsx (ADR-199 table-standard pass) so that file stays small and the
// two modals share one chrome. Legacy centred-panel overlay — unchanged look.

export function Overlay(props: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={props.onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)', maxWidth: 1100 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">{props.title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">{props.children}</div>
      </div>
    </div>
  );
}
