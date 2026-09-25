import React from 'react';
import { Icon } from '../core/Icon.jsx';
export function DocCard({ accent = 'var(--blue)', expanded = false, onToggle, code, onOpen, title, badges, actions, metrics, meta = [], children }) {
  return <div className="panel" style={{ display: 'flex', padding: 0, marginBottom: 8 }}>
    <div style={{ width: 4, flexShrink: 0, background: accent }} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', cursor: onToggle ? 'pointer' : 'default' }}>
        {onToggle ? <span style={{ color: 'var(--text3)', display: 'inline-flex' }}><Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} /></span> : null}
        <span className="td-code" style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 'var(--fs-sm)', cursor: onOpen ? 'pointer' : undefined }} onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}>{code}</span>
        {title ? <span className="fw-700" style={{ fontSize: 'var(--fs-sm)' }}>{title}</span> : null}
        {badges}
        <span style={{ flex: 1 }} />
        {actions ? <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>{actions}</div> : null}
      </div>
      {metrics || meta.length ? <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 12px 8px', cursor: onToggle ? 'pointer' : 'default' }}>
        {metrics}
        <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {meta.map((m, i) => <React.Fragment key={i}>{i ? <span>·</span> : null}<span style={{ whiteSpace: 'nowrap' }}>{m}</span></React.Fragment>)}
        </div>
      </div> : null}
      {expanded && children ? <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>{children}</div> : null}
    </div>
  </div>;
}
export function LinesPanel({ title = 'LINE ITEMS', code, onOpenDetail, children }) {
  return <div style={{ padding: '8px 12px 8px 32px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>▸ {title} — {code}</div>
      {onOpenDetail ? <a style={{ fontSize: 'var(--fs-xs)', color: 'var(--blue)', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}>Open full detail →</a> : null}
    </div>
    {children}
  </div>;
}
