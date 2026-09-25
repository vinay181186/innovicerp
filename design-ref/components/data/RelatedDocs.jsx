import React from 'react';
export function RelatedDocs({ sections = [], activeKey, onSelect, children }) {
  const active = sections.find((s) => s.key === activeKey) || sections[0];
  return <div className="panel">
    <div className="panel-hdr"><h2 className="panel-title">🔗 Related Documents</h2></div>
    <div className="panel-body">
      <div role="tablist" style={{ display: 'flex', flexWrap: 'wrap', border: '1px solid var(--border)', borderRadius: 'var(--radius2) var(--radius2) 0 0', marginBottom: 8 }}>
        {sections.map((s, i) => { const on = active && s.key === active.key; return <button key={s.key} type="button" role="tab" aria-selected={on} onClick={() => onSelect && onSelect(s.key)}
          style={{ background: on ? 'var(--blue3)' : 'transparent', border: 'none', borderRight: i < sections.length - 1 ? '1px solid var(--border)' : 'none', borderBottom: '3px solid ' + (on ? 'var(--blue)' : 'transparent'), padding: '8px 16px', cursor: 'pointer', font: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 600, color: on ? 'var(--blue)' : 'var(--text2)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {s.icon ? s.icon + ' ' : ''}{s.title}<span className="badge b-blue" style={{ borderRadius: 10, padding: '2px 8px' }}>{s.items.length}</span></button>; })}
      </div>
      {active ? <table className="innovic-table tbl-grid tbl-compact" style={{ marginBottom: children ? 18 : 0 }}>
        <thead><tr><th>Code</th><th>Name / Ref</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>{active.items.map((d, i) => <tr key={i}><td className="mono" style={{ fontSize: 'var(--fs-sm)' }}><span className="td-code" style={{ color: 'var(--blue)' }}>{d.code}</span></td>
          <td className="text2" style={{ fontSize: 'var(--fs-sm)' }}>{d.label || '—'}</td><td>{d.status}</td><td className="text2" style={{ fontSize: 'var(--fs-xs)' }}>{d.date || '—'}</td></tr>)}</tbody>
      </table> : null}
      {children}
    </div>
  </div>;
}
