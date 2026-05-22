// Minimal portal-backed modal using the legacy .modal / .modal-lg styles.
// Built inline because the web app doesn't ship @radix-ui/react-dialog yet —
// keeps the PL-4b scope from blowing up.

import { useEffect, type PropsWithChildren, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
    </div>,
    document.body,
  );
}
