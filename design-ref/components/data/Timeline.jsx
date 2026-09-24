import React from 'react';
export function Timeline({ events = [], density = 'regular', variant, title }) {
  const compact = density === 'compact' || variant === 'compact';
  const dot = compact ? 10 : 20; const left = compact ? 5 : 13; const pad = compact ? 18 : 30;
  return <div>
    {title ? <div className={compact ? 'text3' : undefined} style={compact ? { fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 } : { fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 12 }}>{title}</div> : null}
    <div style={{ position: 'relative', paddingLeft: pad }}>
      <div style={{ position: 'absolute', left, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
      {events.map((e, i) => { const color = e.color || 'var(--text3)'; return <div key={i} style={{ position: 'relative', marginBottom: compact ? 6 : 16 }}>
        <div style={{ position: 'absolute', left: -(pad - left) - dot / 2 + 1, top: compact ? 4 : 4, width: dot, height: dot, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-xs)', color: '#fff', zIndex: 1, border: '2px solid var(--bg2)' }}>{compact ? null : e.icon}</div>
        {compact ? <div style={{ fontSize: 'var(--fs-sm)' }}><span className="mono text2" style={{ fontSize: 'var(--fs-xs)', marginRight: 8 }}>{e.date}</span>{e.label}{e.code ? <span className="td-code" style={{ marginLeft: 4, color: 'var(--blue)' }}>{e.code}</span> : null}</div>
          : <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius2)', padding: '8px 12px', borderLeft: '3px solid ' + color }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}><span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color }}>{e.label}{e.code ? <span className="td-code" style={{ marginLeft: 4, color: 'var(--blue)' }}>{e.code}</span> : null}</span><span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{e.date}</span></div>
            {e.detail ? <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>{e.detail}</div> : null}</div>}
      </div>; })}
    </div>
  </div>;
}
