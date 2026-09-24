import React from 'react';
export function TabStrip({ tabs = [], activeKey, onChange }) {
  return <div role="tablist" className="panel" style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 8, borderRadius: 'var(--radius2) var(--radius2) 0 0' }}>
    {tabs.map((t, i) => { const on = t.key === activeKey; return <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange && onChange(t.key)}
      style={{ background: on ? 'var(--blue3)' : 'transparent', border: 'none', borderRight: i < tabs.length - 1 ? '1px solid var(--border)' : 'none', borderBottom: '3px solid ' + (on ? 'var(--blue)' : 'transparent'), padding: '8px 16px', cursor: 'pointer', font: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600, color: on ? 'var(--blue)' : 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {t.label}{t.count != null ? <span className="badge b-blue" style={{ borderRadius: 10, padding: '2px 8px' }}>{t.count}</span> : null}{t.note ? <small className="text3" style={{ fontWeight: 400 }}>{t.note}</small> : null}
    </button>; })}
  </div>;
}
