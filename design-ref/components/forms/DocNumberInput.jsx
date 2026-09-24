import React from 'react';
export function DocNumberInput({ label = 'Doc No.', required = false, value = '', onChange, state = 'idle', message, readOnly = false, placeholder, size = 'sm' }) {
  const border = state === 'bad' ? { borderColor: 'var(--red)' } : state === 'ok' ? { borderColor: 'var(--green)' } : {};
  const icon = state === 'checking' ? '…' : state === 'bad' ? '✕' : state === 'ok' ? '✓' : null;
  const iconColor = state === 'bad' ? 'var(--red)' : state === 'ok' ? 'var(--green)' : 'var(--text3)';
  return <div className={'form-grp f-' + size}>
    <label className="form-label">{label}{required ? <span className="req">★</span> : null}</label>
    <div style={{ position: 'relative' }}>
      <input className="innovic-input" readOnly={readOnly} value={value} placeholder={placeholder} onChange={(e) => onChange && onChange(e.target.value)} style={{ paddingRight: 32, ...border }} />
      {icon && !readOnly ? <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: iconColor, fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{icon}</span> : null}
    </div>
    {readOnly ? <div className="form-help">Code cannot be changed after creation.</div>
      : state === 'checking' ? <div className="form-help">Checking…</div>
      : state === 'bad' ? <div className="form-error">{message || 'Already used — pick another number'}</div>
      : state === 'ok' ? <div className="form-help" style={{ color: 'var(--green)' }}>✓ Available</div>
      : <div className="form-help">Auto-filled with the next number. Edit to use your own — leave blank to auto-generate on save.</div>}
  </div>;
}
