import React from 'react';
const SEV = { critical: 'var(--sig-critical)', warn: 'var(--sig-warn)', info: 'var(--sig-info)' };
export function WorkList({ title = '📋 My Work', items = [], emptyText = "✅ You're all caught up — no pending work.", more }) {
  const crit = items.filter((i) => i.severity === 'critical').length;
  return <div className="panel" style={{ marginBottom: 12 }}>
    <div className="panel-hdr"><span className="panel-title">{title}</span>
      {items.length ? <span className="badge" style={crit ? { background: 'var(--sig-critical-bg)', color: 'var(--sig-critical)' } : undefined}>{crit ? crit + ' critical · ' + items.length + ' total' : items.length + ' item' + (items.length > 1 ? 's' : '')}</span> : null}</div>
    {items.length === 0 ? <div style={{ padding: 16, color: 'var(--sig-ok)', fontWeight: 600 }}>{emptyText}</div> :
      items.map((it, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', borderBottom: '1px solid var(--border)', borderLeft: '3px solid ' + SEV[it.severity || 'info'] }}>
        <span style={{ fontSize: 'var(--fs-sm)' }}>{it.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{it.title}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.detail}</div></div>
        <span title={it.age > 0 ? it.age + ' days old' : 'Today'} style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, width: 36, textAlign: 'right', color: it.severity === 'critical' ? 'var(--sig-critical)' : 'var(--text3)' }}>{it.age > 0 ? it.age + 'd' : '·'}</span>
        <button type="button" className={'btn btn-sm ' + (it.severity === 'critical' ? 'btn-danger' : it.severity === 'warn' ? 'btn-primary' : 'btn-ghost')} style={{ fontSize: 'var(--fs-xs)' }} onClick={it.onAction}>{it.action} →</button>
      </div>)}
    {more ? <div style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--cyan)' }} onClick={more.onClick}>📋 {more.label}</div> : null}
  </div>;
}
export function AttentionList({ items = [], emptyText = '✅ All clear — nothing needs attention.' }) {
  return <div style={{ padding: '8px 16px' }}>{items.length === 0 ? <div style={{ textAlign: 'center', padding: 16, color: 'var(--sig-ok)', fontWeight: 700 }}>{emptyText}</div> :
    items.map((a, i) => <a key={i} className="dash-link" onClick={a.onClick} style={{ cursor: 'pointer' }}><div className="dash-surface" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 4px', borderBottom: '1px solid var(--border)', borderRadius: 4 }}>
      <span style={{ fontSize: 'var(--fs-sm)' }}>{a.icon}</span><span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 600, color: SEV[a.severity || 'info'] }}>{a.label}</span><span style={{ color: 'var(--text3)', fontSize: 'var(--fs-xs)' }}>View →</span></div></a>)}</div>;
}
export function StatRow({ icon, label, value, onClick }) {
  return <a className="dash-link" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}><div className="dash-surface" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 8px', background: 'var(--bg3)', border: '1px solid transparent', borderRadius: 6 }}>
    <span style={{ fontSize: 'var(--fs-md)' }}>{icon}</span><div style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>{label}</div><div style={{ fontSize: 'var(--fs-md)', fontWeight: 800, fontFamily: 'var(--mono)' }}>{value}</div></div></a>;
}
export function QuickLinks({ links = [], title = '🚀 Quick Access' }) {
  return <div><div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>{title}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{links.map((l) => <a key={l.label} className="btn btn-sm" onClick={l.onClick}
      style={{ background: 'color-mix(in srgb, ' + l.color + ' 7%, transparent)', color: l.color, border: '1px solid color-mix(in srgb, ' + l.color + ' 25%, transparent)', fontSize: 'var(--fs-xs)', padding: '4px 8px' }}>{l.icon} {l.label}</a>)}</div></div>;
}
