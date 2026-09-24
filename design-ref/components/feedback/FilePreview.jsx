import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function FilePreview({ fileName, kind = 'pdf', src, canDownload = true, onDownload, onClose, inline = false }) {
  const body = kind === 'none' ? <div className="empty-state" style={{ padding: 32 }}><div style={{ fontSize: 'var(--fs-xl)', marginBottom: 8 }}>📁</div>
      <div className="text2">This file type cannot be previewed in the browser.</div>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>{canDownload ? 'Use Download above to save it and open it on your computer.' : 'You can view drawings but not save them. Ask an administrator if you need a copy.'}</div></div>
    : !src ? <div className="empty-state" style={{ padding: 32 }}>Loading preview…</div>
    : kind === 'pdf' ? <iframe src={src} title={fileName} style={{ width: '100%', height: inline ? 320 : '78vh', border: 0, display: 'block' }} />
    : <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: inline ? 240 : '60vh', padding: 16 }}><img src={src} alt={fileName} style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain' }} /></div>;
  const box = <div className="modal modal-lg">
    <div className="modal-hdr"><div className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>📎 {fileName}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {canDownload ? <button type="button" className="btn btn-primary btn-sm" onClick={onDownload}><Icon name="download" size={13} /> Download</button> : null}
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close preview"><Icon name="x" size={14} /></button></div></div>
    <div className="modal-body" style={{ padding: 0, background: 'var(--bg3)' }}>{body}</div>
  </div>;
  if (inline) return box;
  return <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>{box}</div>;
}
