// The one popup shell every Task Board modal uses. App-standard: portalled to
// <body> so the page shell can't clip it, on the theme's .overlay (z-index 500,
// above the 60 of #topnav) so the top bar never paints over it, with the
// dimmed + blurred backdrop.
//
// `guard` — for the create / edit forms. ESC and a click on the backdrop ask
// "Are you sure you want to exit?" instead of dropping what was typed, the
// same question every create / edit screen asks (lib/exit-guard). The × and
// Cancel buttons are the form's own exits and close straight away, per the
// user's rule that Save / Close / Cancel are already right. Read-only popups
// (Task Detail) leave `guard` off and close on ESC / backdrop directly.
//
// `escLocked` — set while a child popup (file preview, an action modal) is on
// top, so its ESC does not also close this one underneath.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';

/** Widths from the approved board: Assign Task 600px, My To-Do 500px, Detail
 *  the app's wide sheet. `.modal` is the full-window sheet, so the two small
 *  forms cap it inline the way ExitConfirmDialog does. */
export type OverlaySize = 'sm' | 'md' | 'lg';

const SIZE_STYLE: Record<OverlaySize, React.CSSProperties | undefined> = {
  sm: { maxWidth: 500, minHeight: 0 },
  md: { maxWidth: 600, minHeight: 0 },
  lg: undefined,
};

export function Overlay(props: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  size?: OverlaySize | undefined;
  footer?: React.ReactNode;
  guard?: boolean | undefined;
  escLocked?: boolean | undefined;
  /** Kept for the older callers: `wide` = size 'lg'. */
  wide?: boolean | undefined;
}): React.JSX.Element {
  const size: OverlaySize = props.size ?? (props.wide ? 'lg' : 'md');
  const { onClose, guard = false, escLocked = false } = props;
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (escLocked || confirmOpen) return;
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      if (guard) setConfirmOpen(true);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [guard, escLocked, confirmOpen, onClose]);

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (guard) setConfirmOpen(true);
        else onClose();
      }}
    >
      <div
        className={size === 'lg' ? 'modal modal-lg' : 'modal'}
        style={SIZE_STYLE[size]}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hdr">
          <span className="modal-title">{props.title}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <div className="modal-footer">{props.footer}</div> : null}
      </div>
      {confirmOpen ? (
        <ExitConfirmDialog
          onStay={() => setConfirmOpen(false)}
          onExit={() => {
            setConfirmOpen(false);
            onClose();
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

/** The blue note box at the top of the two create forms. */
export function FormNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--blue3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginBottom: 12,
        fontSize: 11,
        color: 'var(--text2)',
      }}
    >
      {children}
    </div>
  );
}

export function FormError({ msg }: { msg: string | null }): React.JSX.Element | null {
  if (!msg) return null;
  return (
    <div role="alert" className="form-error" style={{ marginTop: 8 }}>
      {msg}
    </div>
  );
}
