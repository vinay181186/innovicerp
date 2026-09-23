import React from 'react';
export function ConfirmDialog({ title = 'Are you sure you want to exit?', message = 'Anything entered on this form will be lost.', confirmLabel = 'Exit', cancelLabel = 'Cancel', onConfirm, onCancel, inline = false, tone = 'danger' }) {
  const box = <div className="modal" role="alertdialog" style={{ maxWidth: 420, minHeight: 0 }}>
    <div className="modal-hdr"><div className="modal-title">{title}</div></div>
    <div className="modal-body" style={{ padding: '16px 16px' }}><p style={{ margin: 0, color: 'var(--text2)', fontSize: 'var(--fs-sm)' }}>{message}</p></div>
    <div className="modal-footer"><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} autoFocus>{cancelLabel}</button>
      <button type="button" className={'btn btn-sm btn-' + (tone === 'danger' ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel}</button></div>
  </div>;
  if (inline) return box;
  return <div className="overlay" style={{ alignItems: 'center', justifyContent: 'center', zIndex: 600 }} onMouseDown={(e) => { if (e.target === e.currentTarget && onCancel) onCancel(); }}>{box}</div>;
}
