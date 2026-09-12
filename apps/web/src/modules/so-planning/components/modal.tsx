// Minimal portal-backed modal using the legacy .modal / .modal-lg styles.
// Built inline because the web app doesn't ship @radix-ui/react-dialog yet —
// keeps the PL-4b scope from blowing up.
//
// ESC AND A CLICK OUTSIDE ASK FIRST (user, 2026-09-12). This modal holds the
// Create Plan / Edit Plan / BOM Planning forms, and it used to close on ESC
// the instant the key was pressed -- the user, half-way through adding
// operations, was "out of the screen" with everything gone. Both of those
// exits now raise the same "Are you sure you want to exit?" every create /
// edit screen raises. The × button is the form's own Close and stays as it
// was, per the user's rule that Save / Close / Cancel are already right.

import { useEffect, useState, type PropsWithChildren, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';

interface ModalProps {
  title: string;
  size?: 'sm' | 'lg';
  onClose: () => void;
  footer?: ReactNode;
}

export function Modal({
  title,
  size = 'sm',
  onClose,
  footer,
  children,
}: PropsWithChildren<ModalProps>): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // ESC with a type-to-search dropdown open is that dropdown's key.
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      setConfirmOpen(true);
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, []);

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setConfirmOpen(true);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px',
        zIndex: 1000,
      }}
    >
      <div
        className={size === 'lg' ? 'modal modal-lg' : 'modal'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hdr">
          <div className="modal-title">{title}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
      {confirmOpen ? (
        // Above this modal's own overlay (zIndex 1000), or it would sit
        // behind the very form it is asking about.
        <ExitConfirmDialog
          zIndex={1100}
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
