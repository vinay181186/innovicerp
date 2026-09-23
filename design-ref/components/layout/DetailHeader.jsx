import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function DetailHeader({ backLabel = 'Back', onBack, code, name, badges, actions, children }) {
  return <>
    {onBack ? <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }} onClick={onBack}><Icon name="arrow-left" size={14} /> {backLabel}</button> : null}
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="td-code" style={{ color: 'var(--cyan)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>{code}</span>{badges}
          </div>
          {name ? <div className="panel-title" style={{ marginTop: 2 }}>{name}</div> : null}
        </div>
        {actions ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{actions}</div> : null}
      </div>
      {children ? <div className="panel-body">{children}</div> : null}
    </div>
  </>;
}
export function ReadGrid({ cols, children }) {
  // Canonical: same 12-col grid as FormGrid, so a field sits in the same slot in view and edit. `cols` = legacy.
  return <div className={cols === 2 ? 'form-grid' : cols === 3 ? 'form-grid-3' : cols === 4 ? 'form-grid-4' : 'form-grid-12'}>{children}</div>;
}
export function ReadField({ label, value, size, full = false, mono = false, pre = false }) {
  const s = size || (full ? 'full' : 'md');
  const empty = value == null || value === '';
  return <div className={'form-grp f-' + s + (full ? ' form-full' : '')}>
    <span className="form-label">{label}</span>
    <div className={mono && !empty ? 'mono' : undefined} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, lineHeight: 1.35, color: empty ? 'var(--text3)' : 'var(--text)', whiteSpace: pre ? 'pre-wrap' : undefined, overflowWrap: 'break-word' }}>{empty ? '—' : value}</div>
  </div>;
}
