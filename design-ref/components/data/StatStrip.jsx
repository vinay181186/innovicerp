import React from 'react';
export function StatStrip({ items = [] }) {
  return <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}>
    {items.map((s, i) => {
      const interactive = typeof s.onClick === 'function';
      const Tag = interactive ? 'button' : 'div';
      return <Tag key={s.key || i} type={interactive ? 'button' : undefined} onClick={s.onClick} className={interactive ? 'dash-link dash-cell' : undefined}
        style={{ flex: '1 1 140px', minWidth: 120, textAlign: 'left', padding: '8px 16px', background: 'transparent', border: 'none',
          borderLeft: i === 0 ? 'none' : '1px solid var(--border)', borderBottom: '2px solid ' + (s.active ? (s.color || 'var(--cyan)') : 'transparent'),
          cursor: interactive ? 'pointer' : 'default', font: 'inherit', color: 'inherit' }}>
        <div style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: s.active ? (s.color || 'var(--cyan)') : 'var(--text3)' }}>{s.label}</div>
        <div className="mono fw-700" style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.15, color: s.color || 'var(--text)' }}>{s.count}</div>
        {s.sub ? <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>{s.sub}</div> : null}
      </Tag>;
    })}
  </div>;
}
