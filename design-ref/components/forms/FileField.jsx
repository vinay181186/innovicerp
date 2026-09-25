import React from 'react';
export function FileField({ variant = 'attach', label, fileName, busy = false, error, onPick, onRemove, onView, accept = 'image/*,.pdf', help }) {
  const ref = React.useRef(null);
  const input = <input ref={ref} type="file" accept={accept} style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f && onPick) onPick(f); e.target.value = ''; }} />;
  if (variant === 'attach') return <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
    <label style={{ cursor: busy ? 'not-allowed' : 'pointer', padding: '4px 12px', background: 'var(--bg4)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      📎 {busy ? 'Uploading…' : fileName || label || 'Attach QC Report (optional)'}{input}</label>
    {fileName ? <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 'var(--fs-xs)' }} onClick={onRemove}>× Remove</button> : null}
    {error ? <span style={{ color: 'var(--red)', fontSize: 'var(--fs-xs)' }}>{error}</span> : null}
  </div>;
  return <div className="form-grp form-full">
    <label className="form-label">{label || (variant === 'image' ? 'Product image' : 'Drawing File')} <span className="form-help" style={{ textTransform: 'none' }}>{variant === 'image' ? '(3D render — JPG, PNG or WebP, up to 5 MB)' : '(Image/PDF)'}</span></label>
    {variant === 'drawing' ? <>
      <input type="file" className="innovic-input" accept={accept} disabled={busy} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f && onPick) onPick(f); }} />
      {busy ? <div className="form-help">Uploading…</div> : fileName ? <div className="form-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onView}>📎 {fileName}</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button></div>
        : <div className="form-help">{help || 'Stored privately; opened via a short-lived link.'}</div>}
    </> : <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ width: 96, height: 96, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 'var(--fs-xl)' }}>▣</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 4 }}><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => ref.current && ref.current.click()}>{busy ? 'Uploading…' : fileName ? 'Change image' : 'Choose image'}</button>
          {fileName && !busy ? <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>Remove</button> : null}</div>
        <div className="form-help">{help || (fileName ? 'Shown as a small thumbnail beside the item code on every list. Click it to see it large.' : 'Optional. Resized in the browser before upload, so any photo or render works.')}</div>
      </div>{input}
    </div>}
    {error ? <div className="form-error">{error}</div> : null}
  </div>;
}
