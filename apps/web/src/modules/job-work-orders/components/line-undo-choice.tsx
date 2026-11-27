// ADR-324 — the first panel of the JWSO line Undo list (line-undo-dialog.tsx):
// "How did this happen?" and the "Work was real" answer, which undoes nothing
// and points to Short-close on the JWSO page. No hooks, no state: the dialog
// owns which panel shows.

import { Link } from '@tanstack/react-router';

export const LINE_UNDO_TEXT: React.CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text2)',
  lineHeight: 1.6,
};

const CHOICE: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  whiteSpace: 'normal',
  height: 'auto',
  padding: 'var(--sp-3)',
  lineHeight: 1.5,
};

/** The two big choices. */
export function LineUndoChoice({
  onMistake,
  onReal,
}: {
  onMistake: () => void;
  onReal: () => void;
}): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div className="fw-700">How did this happen?</div>
      <button type="button" className="btn btn-ghost" style={CHOICE} onClick={onMistake}>
        <div className="fw-700">Entered by mistake — no real work on it.</div>
        <div className="text2">Undo each step here, then the line is removed.</div>
      </button>
      <button type="button" className="btn btn-ghost" style={CHOICE} onClick={onReal}>
        <div className="fw-700">Work was real — pieces were really made.</div>
        <div className="text2">Keep the history: Short-close the line on the JWSO page.</div>
      </button>
    </div>
  );
}

/** "Work was real": keep the history — Short-close lives on the JWSO page. */
export function LineUndoWorkWasReal({
  jobWorkOrderId,
  jwCode,
  ln,
}: {
  jobWorkOrderId: string;
  jwCode: string;
  /** "Ln <n>" */
  ln: string;
}): React.JSX.Element {
  return (
    <div style={LINE_UNDO_TEXT}>
      <div>
        Work was real — pieces were really made. Keep the history: Short-close {ln} on the JWSO
        page. Nothing is undone here.
      </div>
      <div style={{ marginTop: 'var(--sp-2)' }}>
        <Link
          to="/job-work-orders/$id"
          params={{ id: jobWorkOrderId }}
          target="_blank"
          rel="noreferrer"
          className="fw-700"
        >
          Open {jwCode} ↗
        </Link>
      </div>
    </div>
  );
}
