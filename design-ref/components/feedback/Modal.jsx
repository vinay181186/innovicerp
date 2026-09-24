import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function Modal({ open = true, title, onClose, footer, children, size = 'md', inline = false }) {
  if (!open) return null;
  const maxW = size === 'sm' ? 560 : size === 'lg' ? 'min(1320px, 96vw)' : 'min(1100px, 96vw)';
  const box = <div className="modal" style={{ maxWidth: maxW }} role="dialog">
    <div className="modal-hdr"><div className="modal-title">{title}</div>
      {onClose ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button> : null}</div>
    <div className="modal-body">{children}</div>
    {footer ? <div className="modal-footer">{footer}</div> : null}
  </div>;
  if (inline) return box;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>{box}</div>;
}
